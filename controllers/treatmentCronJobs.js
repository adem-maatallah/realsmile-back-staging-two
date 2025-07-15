const cron = require("node-cron");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({
  // Enable query logging only in development
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});
const { patientMessaging } = require("../utils/firebaseConfig");

// Default system ID to use when no doctor is assigned
const DEFAULT_SYSTEM_ID = 1;

// Batch size for processing large numbers of notifications
const BATCH_SIZE = 50;

// Helper function to create notification and send Firebase notification
async function createNotificationAndPush(
  treatmentId,
  senderId,
  receiverId,
  title,
  message
) {
  try {
    // Create notification in database
    await prisma.notifications.create({
      data: {
        url_notif: treatmentId.toString(),
        sender_id: senderId,
        receiver_id: receiverId,
        message: message,
        createdAt: new Date(),
      },
    });

    // Send Firebase Cloud Message using user-specific topic
    const payload = {
      notification: {
        title: title,
        body: message,
      },
      data: {
        treatmentId: treatmentId.toString(),
        type: "treatment_notification",
      },
      topic: `user_${receiverId}`,
    };

    await patientMessaging.send(payload);

    // Reduced logging in production
    if (process.env.NODE_ENV === 'development') {
      console.log(`Notification sent to user ${receiverId} about treatment ${treatmentId}`);
    }
  } catch (error) {
    console.error(`Error creating notification for treatment ${treatmentId}:`, error);
  }
}

// Process notifications in batches to avoid memory issues with large datasets
async function processTreatmentsInBatches(treatments, processFunction) {
  // Create batches of the treatments
  const batches = [];
  for (let i = 0; i < treatments.length; i += BATCH_SIZE) {
    batches.push(treatments.slice(i, i + BATCH_SIZE));
  }

  // Process each batch sequentially
  for (const batch of batches) {
    const promises = batch.map(treatment => processFunction(treatment));
    await Promise.all(promises);
  }
}

// Create a cache to avoid redundant notifications (valid for a single cron execution)
const notificationCache = new Set();

// Check if a notification was recently sent
function wasNotificationRecentlySent(key, ttlInMinutes = 60) {
  const cacheKey = `${key}_${Math.floor(Date.now() / (1000 * 60 * ttlInMinutes))}`;
  if (notificationCache.has(cacheKey)) {
    return true;
  }
  notificationCache.add(cacheKey);
  return false;
}

// Clear notification cache periodically (every hour)
setInterval(() => {
  notificationCache.clear();
}, 60 * 60 * 1000);

// 1) TWICE DAILY: Set 'in_progress' treatments to 'overdue' - Once at 12:30 PM and once at 10:30 PM
cron.schedule("30 12,22 * * *", async () => {
  try {
    console.log("[DEBUG] Running overdue check - " + new Date().toISOString());
    const now = new Date();

    // First, update the treatments - do this first to minimize race conditions
    const result = await prisma.treatments.updateMany({
      where: {
        status: "in_progress",
        end_date: {
          lt: now, // Current date is AFTER end_date
        },
      },
      data: { status: "overdue" },
    });

    // If no treatments were updated, exit early
    if (result.count === 0) {
      console.log(`No treatments needed to be set to 'overdue'.`);
      return;
    }

    console.log(`[DEBUG] Overdue Update => ${result.count} treatments set to 'overdue'.`);

    // Then, fetch only the treatments that were updated, with optimized query
    const treatmentsToUpdate = await prisma.treatments.findMany({
      where: {
        status: "overdue",
        // Use a small window of time to only get recently updated treatments
        updated_at: {
          gte: new Date(Date.now() - 5 * 60 * 1000) // Within the last 5 minutes
        }
      },
      select: {
        id: true,
        treatment_number: true,
        cases: {
          select: {
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            },
            doctor: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            }
          }
        }
      },
    });

    // Process notifications in batches
    await processTreatmentsInBatches(treatmentsToUpdate, async (treatment) => {
      const patientUserId = treatment.cases.patient.user.id;
      const doctorUserId = treatment.cases.doctor?.user?.id || DEFAULT_SYSTEM_ID;

      // Get doctor's name for notification title
      const doctorName = treatment.cases.doctor?.user
        ? `Dr. ${treatment.cases.doctor.user.first_name} ${treatment.cases.doctor.user.last_name}`
        : "RealSmile Dental";

      // Check notification cache to avoid duplicate notifications
      const cacheKey = `overdue_${treatment.id}`;
      if (!wasNotificationRecentlySent(cacheKey)) {
        // Notify patient
        const patientTitle = `Traitement en retard - ${doctorName}`;
        const patientMessage = `Votre traitement #${treatment.treatment_number} est maintenant en retard. Veuillez contacter votre médecin.`;
        await createNotificationAndPush(
          treatment.id,
          doctorUserId,
          patientUserId,
          patientTitle,
          patientMessage
        );

        // Notify doctor (only if a doctor is assigned)
        if (treatment.cases.doctor?.user?.id) {
          const doctorTitle = "Alerte de traitement en retard";
          const doctorMessage = `Le traitement #${treatment.treatment_number} pour le patient ${treatment.cases.patient.user.first_name} ${treatment.cases.patient.user.last_name} est maintenant en retard.`;
          await createNotificationAndPush(
            treatment.id,
            DEFAULT_SYSTEM_ID,
            doctorUserId,
            doctorTitle,
            doctorMessage
          );
        }
      }
    });
  } catch (error) {
    console.error("[DEBUG] Error marking treatments overdue:", error);
  }
});

// 2) TWICE DAILY: Set 'pending' treatments to 'in_progress' - At 6:00 AM and 6:00 PM
cron.schedule("0 6,18 * * *", async () => {
  try {
    console.log("[DEBUG] Running in-progress check - " + new Date().toISOString());
    const now = new Date();

    // Update the treatments first
    const result = await prisma.treatments.updateMany({
      where: {
        status: "pending",
        start_date: {
          lte: now,
        },
        end_date: {
          gte: now,
        },
      },
      data: { status: "in_progress" },
    });

    // If no treatments were updated, exit early
    if (result.count === 0) {
      console.log(`No treatments needed to be set to 'in_progress'.`);
      return;
    }

    console.log(`[DEBUG] In-Progress Update => ${result.count} treatments set to 'in_progress'.`);

    // Fetch only the treatments that were updated, with optimized selection
    const treatmentsToUpdate = await prisma.treatments.findMany({
      where: {
        status: "in_progress",
        // Only get recently updated treatments
        updated_at: {
          gte: new Date(Date.now() - 5 * 60 * 1000)
        }
      },
      select: {
        id: true,
        treatment_number: true,
        cases: {
          select: {
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            },
            doctor: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            }
          }
        }
      },
    });

    // Process notifications in batches
    await processTreatmentsInBatches(treatmentsToUpdate, async (treatment) => {
      const patientUserId = treatment.cases.patient.user.id;
      const doctorUserId = treatment.cases.doctor?.user?.id || DEFAULT_SYSTEM_ID;

      // Get doctor's name for notification title
      const doctorName = treatment.cases.doctor?.user
        ? `Dr. ${treatment.cases.doctor.user.first_name} ${treatment.cases.doctor.user.last_name}`
        : "RealSmile Dental";

      // Check cache to avoid duplicate notifications
      const cacheKey = `in_progress_${treatment.id}`;
      if (!wasNotificationRecentlySent(cacheKey)) {
        // Notify patient
        const patientTitle = `Traitement commencé - ${doctorName}`;
        const patientMessage = `Votre traitement #${treatment.treatment_number} a commencé aujourd'hui.`;
        await createNotificationAndPush(
          treatment.id,
          doctorUserId,
          patientUserId,
          patientTitle,
          patientMessage
        );

        // Notify doctor (only if a doctor is assigned)
        if (treatment.cases.doctor?.user?.id) {
          const doctorTitle = "Traitement commencé";
          const doctorMessage = `Le traitement #${treatment.treatment_number} pour le patient ${treatment.cases.patient.user.first_name} ${treatment.cases.patient.user.last_name} a commencé aujourd'hui.`;
          await createNotificationAndPush(
            treatment.id,
            DEFAULT_SYSTEM_ID,
            doctorUserId,
            doctorTitle,
            doctorMessage
          );
        }
      }
    });
  } catch (error) {
    console.error("[DEBUG] Error marking treatments in_progress:", error);
  }
});

// 3) TWICE DAILY: Send notification for treatments starting tomorrow - At 9:00 AM and 7:00 PM
cron.schedule("0 9,19 * * *", async () => {
  try {
    console.log("[DEBUG] Running tomorrow reminders check - " + new Date().toISOString());

    const now = new Date();
    const isEvening = now.getHours() >= 12;

    // Calculate tomorrow's date
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Set time for tomorrow (midnight to end of day)
    const startOfTomorrow = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate()
    );
    const endOfTomorrow = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      23,
      59,
      59,
      999
    );

    // Find treatments for tomorrow with optimized query
    const upcomingTreatments = await prisma.treatments.findMany({
      where: {
        status: "pending",
        start_date: {
          gte: startOfTomorrow,
          lte: endOfTomorrow,
        },
      },
      select: {
        id: true,
        treatment_number: true,
        start_date: true,
        cases: {
          select: {
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            },
            doctor: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            }
          }
        }
      },
    });

    if (upcomingTreatments.length === 0) {
      console.log(`No treatments found starting tomorrow.`);
      return;
    }

    console.log(`[DEBUG] Found ${upcomingTreatments.length} treatments starting tomorrow.`);

    // Create a cache key suffix based on whether it's morning or evening
    const cacheKeySuffix = isEvening ? "evening" : "morning";

    // Process notifications in batches
    await processTreatmentsInBatches(upcomingTreatments, async (treatment) => {
      const patientUserId = treatment.cases.patient.user.id;
      const doctorUserId = treatment.cases.doctor?.user?.id || DEFAULT_SYSTEM_ID;

      // Get doctor's name for notification title
      const doctorName = treatment.cases.doctor?.user
        ? `Dr. ${treatment.cases.doctor.user.first_name} ${treatment.cases.doctor.user.last_name}`
        : "RealSmile Dental";

      // Format the date for the message - only do this if needed
      const formattedDate = treatment.start_date.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      // Customize message based on time of day
      let patientMessage, doctorMessage;
      
      if (isEvening) {
        patientMessage = `Rappel important: Votre traitement #${treatment.treatment_number} commence demain (${formattedDate}). Assurez-vous d'être prêt.`;
        doctorMessage = `Rappel important: Le traitement #${treatment.treatment_number} pour le patient ${treatment.cases.patient.user.first_name} ${treatment.cases.patient.user.last_name} commence demain (${formattedDate}). Dossier prêt?`;
      } else {
        patientMessage = `Rappel: Votre traitement #${treatment.treatment_number} commencera demain (${formattedDate}). Pensez à organiser votre journée.`;
        doctorMessage = `Rappel: Le traitement #${treatment.treatment_number} pour le patient ${treatment.cases.patient.user.first_name} ${treatment.cases.patient.user.last_name} commence demain (${formattedDate}).`;
      }

      // Check cache to avoid duplicate notifications
      const cacheKey = `tomorrow_${treatment.id}_${cacheKeySuffix}`;
      if (!wasNotificationRecentlySent(cacheKey)) {
        // Notify patient about tomorrow's treatment
        const patientTitle = `Traitement à venir - ${doctorName}`;
        await createNotificationAndPush(
          treatment.id,
          doctorUserId,
          patientUserId,
          patientTitle,
          patientMessage
        );

        // Notify doctor (only if a doctor is assigned)
        if (treatment.cases.doctor?.user?.id) {
          const doctorTitle = "Traitement prévu pour demain";
          await createNotificationAndPush(
            treatment.id,
            DEFAULT_SYSTEM_ID,
            doctorUserId,
            doctorTitle,
            doctorMessage
          );
        }
      }
    });
  } catch (error) {
    console.error("[DEBUG] Error sending treatment reminders for tomorrow:", error);
  }
});

// 4) ONCE DAILY: Send notification for treatments starting today - At 7:30 AM
cron.schedule("30 7 * * *", async () => {
  try {
    console.log("[DEBUG] Running today reminders check - " + new Date().toISOString());
    const now = new Date();

    // Set time for today's notifications
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    );

    // Find treatments for today with optimized query
    const todayTreatments = await prisma.treatments.findMany({
      where: {
        status: "pending",
        start_date: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
      select: {
        id: true,
        treatment_number: true,
        start_date: true,
        cases: {
          select: {
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            },
            doctor: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            }
          }
        }
      },
    });

    if (todayTreatments.length === 0) {
      console.log(`No treatments found starting today.`);
      return;
    }

    console.log(`[DEBUG] Found ${todayTreatments.length} treatments starting today.`);

    // Process notifications in batches
    await processTreatmentsInBatches(todayTreatments, async (treatment) => {
      const patientUserId = treatment.cases.patient.user.id;
      const doctorUserId = treatment.cases.doctor?.user?.id || DEFAULT_SYSTEM_ID;

      // Get doctor's name
      const doctorName = treatment.cases.doctor?.user
        ? `Dr. ${treatment.cases.doctor.user.first_name} ${treatment.cases.doctor.user.last_name}`
        : "RealSmile Dental";

      // Format start time if available - only compute if needed
      let timeInfo = "";
      if (treatment.start_date) {
        const hours = treatment.start_date.getHours();
        const minutes = treatment.start_date.getMinutes();
        if (hours !== 0 || minutes !== 0) {
          timeInfo = ` à ${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}`;
        }
      }

      // Check cache to avoid duplicate notifications
      const cacheKey = `today_${treatment.id}`;
      if (!wasNotificationRecentlySent(cacheKey)) {
        // Notify patient
        const patientTitle = `Traitement aujourd'hui - ${doctorName}`;
        const todayMessage = `Bonjour! Votre traitement #${treatment.treatment_number} commence aujourd'hui${timeInfo}. N'oubliez pas votre rendez-vous.`;
        await createNotificationAndPush(
          treatment.id,
          doctorUserId,
          patientUserId,
          patientTitle,
          todayMessage
        );

        // Notify doctor (only if a doctor is assigned)
        if (treatment.cases.doctor?.user?.id) {
          const doctorTitle = "Traitement débutant aujourd'hui";
          const doctorMessage = `Bonjour! Le traitement #${treatment.treatment_number} pour le patient ${treatment.cases.patient.user.first_name} ${treatment.cases.patient.user.last_name} commence aujourd'hui${timeInfo}.`;
          await createNotificationAndPush(
            treatment.id,
            DEFAULT_SYSTEM_ID,
            doctorUserId,
            doctorTitle,
            doctorMessage
          );
        }
      }
    });
  } catch (error) {
    console.error("[DEBUG] Error sending treatment reminders for today:", error);
  }
});

// 5) SPECIAL REMINDER: For overdue treatments - Every Monday and Thursday at 10:00 AM
cron.schedule("0 10 * * 1,4", async () => {
  try {
    console.log("[DEBUG] Running overdue treatment follow-up");
    const now = new Date();
    
    // Find overdue treatments with optimized query
    const overdueTreatments = await prisma.treatments.findMany({
      where: {
        status: "overdue",
      },
      select: {
        id: true,
        treatment_number: true,
        end_date: true,
        cases: {
          select: {
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            },
            doctor: {
              select: {
                user: {
                  select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                  }
                }
              }
            }
          }
        }
      },
    });

    if (overdueTreatments.length === 0) {
      console.log(`No overdue treatments found.`);
      return;
    }
    
    // Get current day of week for cache key (to differentiate Monday vs Thursday)
    const dayOfWeek = now.getDay();
    
    // Process notifications in batches
    await processTreatmentsInBatches(overdueTreatments, async (treatment) => {
      const patientUserId = treatment.cases.patient.user.id;
      const doctorUserId = treatment.cases.doctor?.user?.id || DEFAULT_SYSTEM_ID;
      
      // Calculate days overdue - only if needed
      const endDate = new Date(treatment.end_date);
      const daysOverdue = Math.floor((now - endDate) / (1000 * 60 * 60 * 24));
      
      // Get doctor's name
      const doctorName = treatment.cases.doctor?.user
        ? `Dr. ${treatment.cases.doctor.user.first_name} ${treatment.cases.doctor.user.last_name}`
        : "RealSmile Dental";
      
      // Determine urgency based on days overdue
      let patientMessage = "";
      let urgencyLevel = "";
      
      if (daysOverdue > 30) {
        urgencyLevel = "critical";
        patientMessage = `URGENT: Votre traitement #${treatment.treatment_number} est en retard de plus d'un mois. Veuillez contacter votre médecin immédiatement pour éviter des complications.`;
      } else if (daysOverdue > 14) {
        urgencyLevel = "high";
        patientMessage = `Important: Votre traitement #${treatment.treatment_number} est en retard de ${daysOverdue} jours. Un suivi médical est nécessaire dès que possible.`;
      } else {
        urgencyLevel = "medium";
        patientMessage = `Rappel: Votre traitement #${treatment.treatment_number} est en retard de ${daysOverdue} jours. Veuillez contacter votre médecin pour le reprogrammer.`;
      }
      
      // Check cache to avoid duplicate notifications - use day of week to differentiate
      const cacheKey = `overdue_followup_${treatment.id}_${urgencyLevel}_${dayOfWeek}`;
      if (!wasNotificationRecentlySent(cacheKey, 1440)) { // Valid for 24 hours
        // Notify patient
        const patientTitle = `Action requise - Traitement en retard - ${doctorName}`;
        await createNotificationAndPush(
          treatment.id,
          doctorUserId,
          patientUserId,
          patientTitle,
          patientMessage
        );
        
        // Notify doctor
        if (treatment.cases.doctor?.user?.id) {
          const doctorTitle = "Patient en retard de traitement";
          const doctorMessage = `Le patient ${treatment.cases.patient.user.first_name} ${treatment.cases.patient.user.last_name} est en retard de ${daysOverdue} jours pour le traitement #${treatment.treatment_number}. Un suivi est recommandé.`;
          
          await createNotificationAndPush(
            treatment.id,
            DEFAULT_SYSTEM_ID,
            doctorUserId,
            doctorTitle,
            doctorMessage
          );
        }
      }
    });
  } catch (error) {
    console.error("[DEBUG] Error sending overdue follow-up notifications:", error);
  }
});