const { PrismaClient } = require("@prisma/client");
const {
  devisStatusMap,
  invoicesDbStatusMap,
  invoicesStatusMap,
} = require("../enums/devisEmun");
const { withAccelerate } = require("@prisma/extension-accelerate");
const prisma = new PrismaClient().$extends(withAccelerate());
const {
  uploadSingleFile,
  deleteFileFromStorage,
} = require("../utils/googleCDN");
const multer = require("multer");
const { generateInvoicePdf } = require("../utils/caseUtils");

const upload = multer({ storage: multer.memoryStorage() });
const cpUpload = upload.fields([{ name: "payment_proof", maxCount: 10 }]);

process.env.XDG_RUNTIME_DIR = "/tmp/runtime-root";

exports.fetchAll = async (req, res, next) => {
  const user = req.user;

  try {
    let devises;
    if (user.role === "admin" || user.role === "hachem") {
      devises = await prisma.devis.findMany({
        include: {
          case: {
            include: {
              doctor: {
                select: {
                  user: {
                    select: {
                      first_name: true,
                      last_name: true,
                      profile_pic: true,
                      country: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          id: "desc",
        },
      });
    } else if (user.role === "doctor") {
      const doctor = await prisma.doctors.findUnique({
        where: {
          user_id: parseInt(user.id),
        },
      });
      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found" });
      }
      devises = await prisma.devis.findMany({
        where: {
          caseId: {
            in: (
              await prisma.cases.findMany({
                where: {
                  doctor_id: doctor.id,
                },
                select: {
                  id: true,
                },
              })
            ).map((caseData) => caseData.id),
          },
        },
        include: {
          case: {
            include: {
              doctor: {
                select: {
                  user: {
                    select: {
                      first_name: true,
                      last_name: true,
                      profile_pic: true,
                      country: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          id: "desc",
        },
      });
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updatedDevises = devises.map((devise) => {
      let currency;
      switch (devise.case.doctor.user.country) {
        case "TN":
          currency = "د.ت"; // Tunisian Dinar
          break;
        case "MA":
          currency = "د.م"; // Moroccan Dirham
          break;
        // Add more cases for other countries if needed
        default:
          currency = "€"; // Default to Euro
      }

      return {
        id: devise.id.toString(),
        caseId: devise.caseId.toString(),
        created_at: devise.created_at, // Assuming created_at is not a BigInt
        due_date: devise.due_date,
        price: `${devise.price.toString()} ${currency}`, // Append currency to price
        status: devisStatusMap[devise.status],
        doctor: devise.case?.doctor?.user
          ? {
              fullName: `${devise.case.doctor.user.first_name} ${devise.case.doctor.user.last_name}`,
              profilePic: devise.case.doctor.user.profile_pic,
            }
          : null,
      };
    });

    return res.status(200).json(updatedDevises);
  } catch (error) {
    console.error("Error fetching devises: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getDevisById = async (req, res, next) => {
  const { id } = req.params;
  const user = req.user;
  if (!id || !id.trim() || isNaN(id)) {
    return res.status(400).json({ message: "Invalid devis ID provided." });
  }

  try {
    const devis = await prisma.devis.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        case: {
          include: {
            doctor: {
              select: {
                user: {
                  select: {
                    first_name: true,
                    last_name: true,
                    profile_pic: true,
                    email: true,
                    phone: true,
                    country: true,
                  },
                },
                address: true,
                address_2: true,
              },
            },
            packs: true,
          },
        },
      },
    });

    if (!devis) {
      return res.status(404).json({ message: "Devis not found." });
    }
    console.log("devis: ", devis?.case?.doctor?.user?.country);
    let currencyInit = "€";
    switch (devis?.case?.doctor?.user?.country) {
      case "TN":
        currencyInit = "د.ت";
        break;
      case "MA":
        currencyInit = "د.م";
        break;
      default:
        currencyInit = "€";
    }

    const updatedDevis = {
      id: devis.id.toString(),
      caseId: devis.caseId.toString(),
      created_at: devis.created_at, // Assuming created_at is not a BigInt
      price: devis.price.toString(), // Convert to string if it's a BigInt
      reduction: devis.reduction.toString(),
      dute_date: devis.dute_date,
      pack_name: devis.case.packs.name,
      status: devis.status,
      currency: currencyInit,
      doctor: devis.case?.doctor?.user
        ? {
            fullName: `${devis.case.doctor.user.first_name} ${devis.case.doctor.user.last_name}`,
            profilePic: devis.case.doctor.user.profile_pic,
            email: devis.case.doctor.user.email,
            phone: devis.case.doctor.user.phone,
            address_1: devis.case.doctor.address,
            address_2: devis.case.doctor.address_2,
          }
        : null,
    };
    console.log("updatedDevis: ", updatedDevis);
    return res.status(200).json(updatedDevis);
  } catch (error) {
    console.error("Error fetching devis: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateInvoiceToPaid = async (req, res, next) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ message: "File upload failed." });
    }

    const user = req.user;
    console.log("req.user: ", req.user);
    const { payment_method, payment_transaction_code, id, payed_amount } =
      req.body;
    const file = req.files?.payment_proof ? req.files.payment_proof[0] : null;

    // Validate input
    if (!id || !id.trim() || isNaN(id)) {
      return res.status(400).json({
        message: "Invalid invoice ID provided.",
      });
    }
    if (!payed_amount || isNaN(payed_amount)) {
      return res.status(400).json({
        message: "Valid paid amount is required.",
      });
    }

    try {
      // Start a transaction
      const result = await prisma.$transaction(async (prisma) => {
        // Check for unique payment transaction code
        if (
          payment_transaction_code &&
          payment_transaction_code.trim() !== ""
        ) {
          const existingPayment = await prisma.partial_payments.findUnique({
            where: {
              payment_transaction_code: payment_transaction_code,
            },
          });

          if (existingPayment) {
            throw new Error(
              "Le code de transaction de paiement doit être unique."
            );
          }
        }

        // Fetch the invoice to check existence
        let invoice = await prisma.invoices.findUnique({
          where: {
            id: BigInt(id),
          },
          include: {
            partial_payments: true,
            case: {
              include: {
                doctor: {
                  include: {
                    user: true,
                  },
                },
                packs: true,
              },
            },
            devis: true,
          },
        });

        if (!invoice) {
          throw new Error("Invoice not found.");
        }

        const isOwner = invoice.case.doctor.user_id === user.id;
        console.log("isOwner: ", isOwner);
        const isAdmin = user.role === "admin";

        if (!isOwner && !isAdmin) {
          throw new Error("You do not have permission to pay this invoice.");
        }

        // Check if the invoice is already fully paid
        if (invoice.payment_status === "paid") {
          return {
            status: 200,
            message: "Invoice is already paid.",
          };
        }

        // Calculate the total paid amount including the new payment
        const totalPaid = await prisma.partial_payments.aggregate({
          where: {
            invoice_id: BigInt(id),
          },
          _sum: {
            amount: true,
          },
        });

        const newTotalPaid =
          (parseFloat(totalPaid._sum.amount) || 0) + parseFloat(payed_amount);
        console.log(
          "newTotalPaid: ",
          newTotalPaid,
          "invoice.amount: ",
          invoice.amount
        );

        if (newTotalPaid > parseFloat(invoice.amount)) {
          throw new Error("Le montant payé dépasse le montant de la facture.");
        }

        // Upload payment proof file if it exists
        let fileUrl = null;
        if (file) {
          fileUrl = await uploadSingleFile(
            file,
            id, // Pass the invoiceId instead of caseId
            process.env.GOOGLE_STORAGE_BUCKET_PAYMENT_FILES
          );
        }

        // Create a partial payment record with pdfUrl
        await prisma.partial_payments.create({
          data: {
            invoice_id: BigInt(id),
            amount: parseFloat(payed_amount),
            payment_method: payment_method,
            payment_transaction_code: payment_transaction_code,
            payment_date: new Date(),
            payment_proof_url: fileUrl, // Store the file URL
          },
        });

        // Update invoice status based on the total paid amount
        if (newTotalPaid === parseFloat(invoice.amount)) {
          await prisma.invoices.update({
            where: {
              id: BigInt(id),
            },
            data: {
              payment_status: "paid",
            },
          });
          return {
            status: 200,
            message: "Invoice paid successfully.",
          };
        } else if (newTotalPaid < parseFloat(invoice.amount)) {
          await prisma.invoices.update({
            where: {
              id: BigInt(id),
            },
            data: {
              payment_status: "partially_paid",
            },
          });
          return {
            status: 200,
            message: "Partial payment recorded successfully.",
          };
        }
      });

      return res.status(result.status).json({ message: result.message });
    } catch (error) {
      console.error("Error updating invoice to paid: ", error.message);
      if (
        error.message === "Le code de transaction de paiement doit être unique."
      ) {
        return res.status(400).json({ message: error.message });
      } else if (error.message === "Invoice not found.") {
        return res.status(404).json({ message: error.message });
      } else if (
        error.message === "You do not have permission to pay this invoice."
      ) {
        return res.status(403).json({ message: error.message });
      } else if (
        error.message === "Le montant payé dépasse le montant de la facture."
      ) {
        return res.status(400).json({ message: error.message });
      } else {
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  });
};

exports.fetchAllInvoices = async (req, res, next) => {
  const user = req.user;

  try {
    let invoices;
    if (
      user.role === "admin" ||
      user.role === "hachem" ||
      user.role === "finance"
    ) {
      invoices = await prisma.invoices.findMany({
        include: {
          case: {
            include: {
              doctor: {
                select: {
                  user: {
                    select: {
                      first_name: true,
                      last_name: true,
                      profile_pic: true,
                      country: true,
                    },
                  },
                },
              },
              patient: {
                select: {
                  first_name: true,
                  last_name: true,
                },
              },
              status_histories: {
                where: {
                  OR: [{ name: "pending" }, { name: "in_construction" }],
                },
                orderBy: {
                  created_at: "desc",
                },
                select: {
                  name: true,
                  created_at: true,
                },
              },
            },
          },
          partial_payments: true,
        },
        orderBy: {
          id: "desc",
        },
      });
    } else if (user.role === "doctor") {
      const doctor = await prisma.doctors.findUnique({
        where: {
          user_id: parseInt(user.id),
        },
      });
      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found" });
      }
      invoices = await prisma.invoices.findMany({
        where: {
          case_id: {
            in: (
              await prisma.cases.findMany({
                where: {
                  doctor_id: doctor.id,
                },
                select: {
                  id: true,
                },
              })
            ).map((caseData) => caseData.id),
          },
        },
        include: {
          case: {
            include: {
              doctor: {
                select: {
                  user: {
                    select: {
                      first_name: true,
                      last_name: true,
                      profile_pic: true,
                      country: true,
                    },
                  },
                },
              },
              patient: {
                select: {
                  first_name: true,
                  last_name: true,
                },
              },
              status_histories: {
                where: {
                  OR: [{ name: "pending" }, { name: "in_construction" }],
                },
                orderBy: {
                  created_at: "desc",
                },
                select: {
                  name: true,
                  created_at: true,
                },
              },
            },
          },
          partial_payments: true,
        },
        orderBy: {
          id: "desc",
        },
      });
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updatedInvoices = await Promise.all(
      invoices.map(async (invoice) => {
        let currency;
        switch (invoice.case.doctor.user.country) {
          case "TN":
            currency = "د.ت"; // Tunisian Dinar
            break;
          case "MA":
            currency = "د.م"; // Moroccan Dirham
            break;
          default:
            currency = "€"; // Default to Euro
        }

        // Directly use the invoice's created_at property instead of computing from status_histories
        const totalPaidResult = await prisma.partial_payments.aggregate({
          where: {
            invoice_id: BigInt(invoice.id),
          },
          _sum: {
            amount: true,
          },
        });

        const totalPaid = parseFloat(totalPaidResult._sum.amount) || 0;
        const reste_a_payer = parseFloat(invoice.amount) - totalPaid;

        return {
          id: invoice.id.toString(),
          caseId: invoice.case_id.toString(),
          created_at: invoice.created_at,
          due_date: invoice.due_date,
          amount: `${invoice.amount.toString()} ${currency}`,
          payment_status: invoicesStatusMap[invoice.payment_status],
          invoice_ref: invoice.invoice_ref,
          doctor: invoice.case?.doctor?.user
            ? {
                fullName: `${invoice.case.doctor.user.first_name} ${invoice.case.doctor.user.last_name}`,
                profilePic: invoice.case.doctor.user.profile_pic,
              }
            : null,
          patient_name:
            invoice.case.patient.first_name +
            " " +
            invoice.case.patient.last_name,
          reste_a_payer: `${reste_a_payer.toFixed(2)} ${currency}`,
        };
      })
    );

    return res.status(200).json(updatedInvoices);
  } catch (error) {
    console.error("Error fetching invoices: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.fetchAllInvoicesByDoctor = async (req, res) => {
  const { id } = req.params; // Doctor's user_id from request params

  try {
    const { role, id: commercialId } = req.user;

    // Fetch doctor details in one query
    const doctor = await prisma.doctors.findUnique({
      where: {
        user_id: parseInt(id),
      },
      select: {
        id: true,
        address: true,
        address_2: true,
        city: true,
        state: true,
        zip: true,
        speciality: true,
        user: {
          select: {
            first_name: true,
            last_name: true,
            country: true,
            email: true,
            phone: true,
            commercial_id: true,
          },
        },
      },
    });

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // Authorization check for commercial role
    if (role === "commercial" && doctor.user.commercial_id !== commercialId) {
      return res.status(401).json({
        message: "You are not authorized to access invoices for this doctor.",
      });
    }

    const doctorId = doctor.id;
    const country = doctor.user.country;

    // Determine the currency based on the doctor's country
    const currency = country === "TN" ? "د.ت" : country === "MA" ? "د.م" : "€";

    // Fetch all invoices and related data in a single query
    const invoices = await prisma.invoices.findMany({
      where: {
        case: {
          doctor_id: doctorId,
        },
      },
      include: {
        partial_payments: true,
        case: {
          include: {
            doctor: {
              select: {
                user: {
                  select: {
                    first_name: true,
                    last_name: true,
                    profile_pic: true,
                    country: true,
                  },
                },
              },
            },
            patient: {
              select: {
                first_name: true,
                last_name: true,
              },
            },
            status_histories: {
              where: {
                OR: [{ name: "pending" }, { name: "in_construction" }],
              },
              orderBy: {
                created_at: "desc",
              },
              select: {
                name: true,
                created_at: true,
              },
            },
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    });

    // Calculate totals
    let totalAmount = 0;
    let paidAmount = 0;
    let unpaidAmount = 0;

    // Process invoices and calculate totals
    const updatedInvoices = invoices.map((invoice) => {
      const invoiceAmount = parseFloat(invoice.amount);
      totalAmount += invoiceAmount;

      const totalPaidForInvoice = invoice.partial_payments.reduce(
        (acc, payment) => acc + parseFloat(payment.amount),
        0
      );

      paidAmount += totalPaidForInvoice;
      unpaidAmount += invoiceAmount - totalPaidForInvoice;

      // Directly use the invoice's created_at property instead of computing from status_histories
      const createdAt = invoice.created_at;

      return {
        id: invoice.id.toString(),
        caseId: invoice.case_id.toString(),
        created_at: createdAt,
        due_date: invoice.due_date,
        amount: `${invoiceAmount.toFixed(2)} ${currency}`,
        payment_status: invoicesStatusMap[invoice.payment_status], // Map payment status
        invoice_ref: invoice.invoice_ref,
        doctor: invoice.case?.doctor?.user
          ? {
              fullName: `${invoice.case.doctor.user.first_name} ${invoice.case.doctor.user.last_name}`,
              profilePic: invoice.case.doctor.user.profile_pic,
            }
          : null,
        patient_name: `${invoice.case.patient.first_name} ${invoice.case.patient.last_name}`,
        reste_a_payer: `${(invoiceAmount - totalPaidForInvoice).toFixed(
          2
        )} ${currency}`,
      };
    });

    // Return the response with doctor details and formatted invoices
    return res.status(200).json({
      doctor: {
        fullName: `${doctor.user.first_name} ${doctor.user.last_name}`,
        email: doctor.user.email,
        phone: doctor.user.phone,
        address: doctor.address,
        address_2: doctor.address_2,
        city: doctor.city,
        state: doctor.state,
        zip: doctor.zip,
        country: doctor.user.country,
        speciality: doctor.speciality,
      },
      totalAmount: totalAmount.toFixed(2),
      paidAmount: paidAmount.toFixed(2),
      unpaidAmount: unpaidAmount.toFixed(2),
      currency,
      invoices: updatedInvoices,
    });
  } catch (error) {
    console.error("Error fetching invoices: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.fetchAllPartialPaymentsByDoctor = async (req, res, next) => {
  const { id } = req.params; // Doctor's user_id from request params

  try {
    const { role, id: commercialId } = req.user;

    // Fetch the doctor using the user ID
    const doctor = await prisma.doctors.findUnique({
      where: {
        user_id: id,
      },
      select: {
        id: true,
        address: true,
        address_2: true,
        city: true,
        state: true,
        zip: true,
        user: {
          select: {
            first_name: true,
            last_name: true,
            country: true,
            email: true,
            phone: true,
            profile_pic: true,
            commercial_id: true, // Include the commercial_id
          },
        },
      },
    });

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // If the user role is commercial, check if the doctor is assigned to this commercial
    if (role === "commercial" && doctor.user.commercial_id !== commercialId) {
      return res.status(401).json({
        message:
          "You are not authorized to access partial payments for this doctor.",
      });
    }

    const doctorId = doctor.id;
    const country = doctor.user.country;

    // Determine currency based on the country
    let currency = "EURO";
    if (country === "TN") {
      currency = "TND";
    } else if (country === "MA") {
      currency = "MAD";
    }

    // Fetch partial payments associated with the doctor's cases
    const invoices = await prisma.invoices.findMany({
      where: {
        case_id: {
          in: (
            await prisma.cases.findMany({
              where: {
                doctor_id: doctorId,
              },
              select: {
                id: true,
              },
            })
          ).map((caseData) => caseData.id),
        },
      },
      include: {
        case: {
          include: {
            doctor: {
              select: {
                user: {
                  select: {
                    first_name: true,
                    last_name: true,
                    profile_pic: true,
                    country: true,
                    profile_pic: true,
                    email: true,
                  },
                },
              },
            },
            patient: {
              select: {
                first_name: true,
                last_name: true,
              },
            },
          },
        },
        partial_payments: true, // Include partial payments
      },
      orderBy: {
        id: "desc",
      },
    });

    // Process each invoice to extract partial payments
    const partialPayments = invoices.flatMap((invoice) =>
      invoice.partial_payments.map((payment) => {
        let paymentCurrency;
        switch (invoice.case.doctor.user.country) {
          case "TN":
            paymentCurrency = "د.ت"; // Tunisian Dinar
            break;
          case "MA":
            paymentCurrency = "د.م"; // Moroccan Dirham
            break;
          default:
            paymentCurrency = "€"; // Default to Euro
        }

        return {
          id: payment.id.toString(),
          invoiceId: payment.invoice_id.toString(),
          caseId: invoice.case_id.toString(),
          payment_date: payment.payment_date,
          amount: `${payment.amount.toString()} ${paymentCurrency}`,
          payment_method: payment.payment_method,
          payment_transaction_code: payment.payment_transaction_code,
          payment_proof_url: payment.payment_proof_url,
          doctor: invoice.case?.doctor?.user
            ? {
                fullName: `${invoice.case.doctor.user.first_name} ${invoice.case.doctor.user.last_name}`,
                profile_pic: invoice.case.doctor.user.profile_pic,
                email: invoice.case.doctor.user.email,
              }
            : null,
          patient_name: invoice.case.patient
            ? `${invoice.case.patient.first_name} ${invoice.case.patient.last_name}`
            : null,
        };
      })
    );

    // Include doctor's information in the response along with the partial payments
    return res.status(200).json({
      doctor: {
        full_name: `${doctor.user.first_name} ${doctor.user.last_name}`,
        profile_pic: doctor.user.profile_pic,
        email: doctor.user.email,
        phone: doctor.user.phone,
        address: doctor.address,
        address_2: doctor.address_2,
        city: doctor.city,
        state: doctor.state,
        zip: doctor.zip,
        country: doctor.user.country,
      },
      currency,
      partialPayments, // Include the list of partial payments in the response
    });
  } catch (error) {
    console.error("Error fetching partial payments: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.addPaymentToDoctor = async (req, res, next) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ message: "File upload failed." });
    }

    const {
      payment_method,
      payment_transaction_code,
      payed_amount,
      payment_date,
    } = req.body;
    const userId = BigInt(req.params.id); // Convert user ID to BigInt
    const file = req.files?.payment_proof ? req.files.payment_proof[0] : null;

    // Validate input
    if (!userId) {
      return res.status(400).json({
        message: "Invalid doctor user ID provided.",
      });
    }
    const payedAmountFloat = parseFloat(payed_amount);
    if (isNaN(payedAmountFloat) || payedAmountFloat <= 0) {
      return res.status(400).json({
        message: "Valid paid amount is required.",
      });
    }

    try {
      const result = await prisma.$transaction(async (prisma) => {
        // Find the doctor using the user ID
        const doctor = await prisma.doctors.findUnique({
          where: {
            user_id: userId,
          },
        });

        if (!doctor) {
          throw new Error("Doctor not found.");
        }

        const doctorId = doctor.id;

        // Check for an existing payment with the same transaction code
        if (
          payment_transaction_code &&
          payment_transaction_code.trim() !== ""
        ) {
          const existingPayment = await prisma.partial_payments.findFirst({
            where: {
              payment_transaction_code: payment_transaction_code,
            },
          });

          if (existingPayment) {
            throw new Error(
              "Le code de transaction de paiement doit être unique."
            );
          }
        }

        // Fetch the doctor's unpaid invoices ordered by creation date
        let invoices = await prisma.invoices.findMany({
          where: {
            case: {
              doctor_id: doctorId, // Ensure this matches the doctor.id
            },
            payment_status: {
              not: "paid",
            },
          },
          orderBy: {
            created_at: "asc",
          },
          include: {
            partial_payments: true,
            case: true, // Just include the case, no need to load nested doctor/user relations
            devis: true,
          },
        });

        if (invoices.length === 0) {
          throw new Error("No unpaid invoices found for the doctor.");
        }

        let remainingAmount = payedAmountFloat;
        for (let invoice of invoices) {
          const totalPaid = await prisma.partial_payments.aggregate({
            where: {
              invoice_id: invoice.id,
            },
            _sum: {
              amount: true,
            },
          });

          const currentPaid = parseFloat(totalPaid._sum.amount) || 0;
          const invoiceAmount = parseFloat(invoice.amount);
          const remainingInvoiceAmount = invoiceAmount - currentPaid;

          if (remainingAmount <= 0) {
            break;
          }

          // If invoice doesn't have a devis, create one
          if (!invoice.devis) {
            invoice.devis = await prisma.devis.create({
              data: {
                caseId: invoice.case_id,
                price: invoice.amount.toString(),
              },
            });
          }

          let paymentToApply = Math.min(
            remainingAmount,
            remainingInvoiceAmount
          );

          // Upload payment proof file if it exists
          let fileUrl = null;
          if (file) {
            fileUrl = await uploadSingleFile(
              file,
              invoice.id.toString(),
              process.env.GOOGLE_STORAGE_BUCKET_PAYMENT_FILES
            );
          }

          // Create a partial payment record with pdfUrl
          await prisma.partial_payments.create({
            data: {
              invoice_id: invoice.id,
              amount: paymentToApply,
              payment_method: payment_method,
              payment_transaction_code: payment_transaction_code,
              payment_date: new Date(payment_date),
              payment_proof_url: fileUrl,
            },
          });

          remainingAmount -= paymentToApply;

          // Update the invoice status if fully paid
          if (paymentToApply >= remainingInvoiceAmount) {
            await prisma.invoices.update({
              where: {
                id: invoice.id,
              },
              data: {
                payment_status: "paid",
              },
            });
          } else {
            await prisma.invoices.update({
              where: {
                id: invoice.id,
              },
              data: {
                payment_status: "partially_paid",
              },
            });
          }
        }

        return {
          status: 200,
          message: "Payment processed successfully.",
        };
      });

      return res.status(result.status).json({ message: result.message });
    } catch (error) {
      console.error("Error processing payment: ", error.message);
      if (
        error.message === "Le code de transaction de paiement doit être unique."
      ) {
        return res.status(400).json({ message: error.message });
      } else if (error.message === "Doctor not found.") {
        return res.status(404).json({ message: error.message });
      } else if (
        error.message === "Le montant payé dépasse le montant de la facture."
      ) {
        return res.status(400).json({ message: error.message });
      } else {
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  });
};

exports.fetchInvoiceById = async (req, res, next) => {
  const { id } = req.params;
  const user = req.user;

  try {
    let invoice;

    if (
      user.role === "admin" ||
      user.role === "hachem" ||
      user.role === "finance"
    ) {
      invoice = await prisma.invoices.findUnique({
        where: {
          id: parseInt(id),
        },
        include: {
          case: {
            include: {
              doctor: {
                select: {
                  user: {
                    select: {
                      first_name: true,
                      last_name: true,
                      country: true,
                    },
                  },
                  address: true,
                  address_2: true,
                },
              },
              packs: {
                select: {
                  name: true,
                  eur_price: true,
                  drh_price: true,
                  tnd_price: true,
                },
              },
              patient: {
                select: {
                  first_name: true,
                  last_name: true,
                },
              },
            },
          },
          devis: true,
          partial_payments: true, // Include partial payments
        },
      });
    } else if (user.role === "doctor") {
      const doctor = await prisma.doctors.findUnique({
        where: {
          user_id: parseInt(user.id),
        },
      });
      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found" });
      }
      invoice = await prisma.invoices.findFirst({
        where: {
          id: parseInt(id),
          case: {
            doctor_id: doctor.id,
          },
        },
        include: {
          case: {
            include: {
              doctor: {
                select: {
                  user: {
                    select: {
                      first_name: true,
                      last_name: true,
                      country: true,
                    },
                  },
                  address: true,
                  address_2: true,
                },
              },
              packs: {
                select: {
                  name: true,
                  eur_price: true,
                  tnd_price: true,
                  drh_price: true,
                },
              },
              patient: {
                select: {
                  first_name: true,
                  last_name: true,
                },
              },
            },
          },
          devis: true,
          partial_payments: true, // Include partial payments
        },
      });
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    let currency;
    let amountBeforeReduction;
    switch (invoice.country_code) {
      case "TN":
        currency = "د.ت"; // Tunisian Dinar
        amountBeforeReduction = invoice.case.packs.tnd_price.toString(); // Append currency to amount
        break;
      case "MA":
        currency = "د.م"; // Moroccan Dirham
        amountBeforeReduction = invoice.case.packs.drh_price.toString(); // Append currency to amount
        break;
      // Add more cases for other countries if needed
      default:
        currency = "€"; // Default to Euro
        amountBeforeReduction = invoice.case.packs.eur_price.toString(); // Append currency to amount
    }

    const formattedInvoice = {
      id: invoice.id.toString(),
      caseId: invoice.case_id.toString(),
      created_at: invoice.created_at, // Assuming created_at is not a BigInt
      due_date: invoice.due_date,
      product_name: invoice.case.packs?.name, // Access the packs name correctly
      amountAfterReduction: `${invoice.amount.toString()}`, // Append currency to amount
      amountBeforeReduction, // Append currency to amount
      currency: currency,
      reduction: invoice.devis?.reduction, // Access the reduction correctly
      payment_status: invoicesStatusMap[invoice.payment_status],
      invoice_ref: invoice.invoice_ref,
      doctor: invoice.case?.doctor?.user
        ? {
            fullName: `${invoice.case.doctor.user.first_name} ${invoice.case.doctor.user.last_name}`,
            address: invoice.case.doctor.address,
            address_2: invoice.case.doctor.address_2,
            country: invoice.case.doctor.user.country,
          }
        : undefined,
      patient: invoice.case?.patient
        ? {
            fullName: `${invoice.case.patient.first_name} ${invoice.case.patient.last_name}`,
          }
        : undefined,
      partial_payments: invoice.partial_payments.map((payment) => ({
        id: payment.id.toString(),
        amount: payment.amount.toFixed(2),
        payment_date: payment.payment_date,
        payment_method: payment.payment_method,
        payment_transaction_code: payment.payment_transaction_code,
        payment_proof_url: payment.payment_proof_url,
      })),
      invoice_url: invoice.pdf_link, // Add the invoice URL
    };

    return res.status(200).json(formattedInvoice);
  } catch (error) {
    console.error("Error fetching invoice: ", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteInvoice = async (req, res, next) => {
  const { id } = req.params;
  const user = req.user;
  const invoice = await prisma.invoices.findUnique({
    where: {
      id: parseInt(id),
    },
  });
  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }
  if (user.role === "admin") {
    try {
      await prisma.invoices.delete({
        where: {
          id: parseInt(id),
        },
      });
      return res.status(204).json({ message: "Invoice deleted successfully" });
    } catch (error) {
      console.error("Error deleting invoice: ", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  } else {
    return res.status(403).json({ message: "Forbidden" });
  }
};

exports.updateInvoiceAmount = async (req, res) => {
  const { invoiceId } = req.params;
  const { amount, password, date } = req.body;

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Validate input
  if (!invoiceId || amount === undefined || date === undefined) {
    return res
      .status(400)
      .json({ message: "Invoice ID , date and amount are required" });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 0) {
    return res.status(400).json({ message: "Invalid amount value" });
  }

  try {
    // Fetch existing invoice with relations
    const invoice = await prisma.invoices.findUnique({
      where: { id: BigInt(invoiceId) },
      include: {
        case: {
          include: {
            packs: true,
            doctor: {
              include: {
                user: true,
              },
            },
          },
        },
        devis: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Check for associated devis
    if (!invoice.devis) {
      return res.status(400).json({ message: "No associated devis found" });
    }

    const devis = invoice.devis;
    const originalPrice = parseFloat(devis.price);
    let packPrice;
    switch (invoice.case.doctor.user.country) {
      case "TN":
        packPrice = invoice.case.packs.tnd_price;
        break;
      case "MA":
        packPrice = invoice.case.packs.drh_price;
        break;
      default:
        packPrice = invoice.case.packs.eur_price;
    }

    // Calculate new reduction percentage
    const reductionPercentage = parseFloat(
      ((packPrice - numericAmount) / packPrice) * 100
    );

    if (reductionPercentage < 0 || reductionPercentage > 100) {
      return res.status(400).json({
        message: "Invalid amount: Calculated reduction out of bounds (0-100%)",
      });
    }

    // Update devis record with new price and reduction
    await prisma.devis.update({
      where: { id: devis.id },
      data: {
        reduction: reductionPercentage,
      },
    });

    // Update invoice with new amount
    const updatedInvoice = await prisma.invoices.update({
      where: { id: BigInt(invoiceId) },
      data: { amount: numericAmount, created_at: new Date(date) },
      include: {
        case: {
          include: {
            packs: true,
            doctor: {
              include: {
                user: true,
              },
            },
          },
        },
        devis: true,
      },
    });

    // Delete existing PDF if present
    /* if (invoice.pdf_link) {
      await deleteFileFromStorage(
        process.env.GOOGLE_STORAGE_BUCKET_INVOICE_PDFS,
        invoice.pdf_link
      );
    } */

    // Generate new PDF with updated values
    const pdfUrl = await generateInvoicePdf(updatedInvoice);

    // Update invoice with new PDF link
    const finalInvoice = await prisma.invoices.update({
      where: { id: BigInt(invoiceId) },
      data: { pdf_link: pdfUrl },
      include: {
        case: {
          include: {
            doctor: {
              include: {
                user: true,
              },
            },
          },
        },
        devis: true,
      },
    });

    return res
      .status(200)
      .json({ message: "Invoice updated successfully", amount });
  } catch (error) {
    console.error("Error updating invoice:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
