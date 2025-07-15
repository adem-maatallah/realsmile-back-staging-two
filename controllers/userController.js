const asyncHandler = require("express-async-handler");
const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());
const { BadRequestError, NotFoundError } = require("../middlewares/apiError");
const {
  SuccessMsgResponse,
  SuccessResponse,
  SuccessMsgDataResponse,
} = require("../middlewares/apiResponse");
const { createMobileUserUtils } = require("../firebase/mobileUser");
const bcrypt = require("bcrypt");
const {
  userRoleMapTranslatedToFrench,
  userStatusMapTranslatedToFrench,
} = require("../enums/userEnum");
const sendEmail = require("../utils/email");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const {
  doc,
  updateDoc,
  arrayUnion,
  getDoc,
  setDoc,
  getFirestore,
} = require("firebase/firestore");
const admin = require("firebase-admin");
const { doctorFirestore, db } = require("../utils/firebaseConfig");
const queueEmail = require("../utils/email");
const logger = require("../utils/logger");
const QRCode = require("qrcode");

admin.initializeApp({
  credential: admin.credential.cert(process.env.GOOGLE_STORAGE_KEY_FILENAME),
});

exports.getUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Fetch the user along with the related doctor details if the user is a doctor
  const user = await prisma.users.findUnique({
    where: {
      id: parseInt(id),
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      user_name: true,
      email: true,
      profile_pic: true,
      country: true,
      phone: true,
      commercial_id: true,
      role: {
        select: {
          name: true,
        },
      },
      doctors: {
        select: {
          speciality: true,
          office_phone: true,
          address: true,
          address_2: true,
          city: true,
          zip: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError("No user found with that id");
  }

  // Remove the doctor details if the user is not a doctor
  if (user.role.name !== "doctor") {
    delete user.doctors;
  }
  user.role = user.role.name;

  // Convert BigInt IDs to strings
  const userResponse = {
    ...user,
    id: user.id.toString(),
    commercial_id: user?.commercial_id?.toString(),
  };

  return new SuccessResponse(userResponse).send(res);
});

exports.createUser = asyncHandler(async (req, res) => {
  const { email, role, password, ...userData } = req.body;

  if (
    await prisma.users.findUnique({
      where: {
        email,
      },
    })
  ) {
    throw new BadRequestError("A user with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const roleId = await prisma.roles.findFirst({
    where: {
      name: role,
    },
  })?.id;
  const user = await prisma.users.create({
    data: {
      email,
      password: hashedPassword,
      role_id: roleId,
      ...userData,
    },
  });

  const roleHandlers = {
    patient: "patients",
    doctor: "doctors",
    labo: "labos",
  };

  const roleModel = roleHandlers[roleRecord.name];
  if (!roleModel) {
    throw new BadRequestError(
      "Invalid role or role does not have a corresponding data model"
    );
  }

  await prisma[roleModel].create({
    data: {
      user_id: user.id,
      ...req.body[`${roleRecord.name}Details`],
    },
  });

  const { password: _, ...data } = user;
  return new SuccessMsgDataResponse(data, "User created successfully").send(
    res
  );
});

exports.getUsers = asyncHandler(async (req, res) => {
  const users = await prisma.users.findMany({
    include: {
      role: true,
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (!users || users.length === 0) {
    return new SuccessMsgResponse([]).send(res);
  }

  const usersWithNumericId = users.map((user) => ({
    ...user,
    id: Number(user.id),
    role_id: Number(user.role_id),
    role: userRoleMapTranslatedToFrench[user.role.name],
    status: userStatusMapTranslatedToFrench[user.status],
    commercial_id: Number(user.commercial_id),
  }));

  return new SuccessResponse(usersWithNumericId).send(res);
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await prisma.users.findUnique({
    where: {
      id: parseInt(id),
    },
  });
  if (!user) {
    throw new NotFoundError("User not registered");
  }

  await prisma.users.delete({
    where: {
      id: parseInt(id),
    },
  });
  return new SuccessMsgDataResponse("User deleted successfully").send(res);
});

exports.updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Remove spaces from the phone number
  req.body.phone = req.body.phone?.replace(/\s+/g, "");

  // Fetch the existing user
  let existingUser = await prisma.users.findUnique({
    where: {
      id,
    },
    include: {
      doctors: true, // Assuming there's a one-to-one relationship named 'doctors'
    },
  });

  if (!existingUser) {
    throw new BadRequestError("User not found");
  }

  // Invalidate email and phone verification if they have changed
  if (existingUser.email !== req.body.email) {
    req.body.email_verified = false;
  }
  if (existingUser.phone !== req.body.phone) {
    req.body.phone_verified = false;
  }

  // Update general user data
  const updatedUser = await prisma.users.update({
    where: {
      id,
    },
    data: {
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      user_name: req.body.user_name,
      email: req.body.email,
      phone: req.body.phone, // <-- Use the new phone number from the request body
      country: req.body.country,
      email_verified: req.body.email_verified,
      phone_verified: req.body.phone_verified,
    },
  });

  // Update doctor-specific data if the user is a doctor
  if (existingUser.doctors) {
    const doctorData = {
      speciality: req.body.speciality,
      office_phone: req.body?.office_phone?.replace(/\s+/g, ""),
      address: req.body.address,
      address_2: req.body.address_2,
      city: req.body.city,
      zip: req.body.zip,
    };
    await prisma.doctors.update({
      where: {
        user_id: id,
      },
      data: doctorData,
    });
  }

  if (existingUser.phone !== req.body.phone) {
    const firestore = getFirestore();
    const phn = req.body.phone; // Full phone number with country code
    // Extract the raw phone number (without country code)
    // This regex assumes country codes are between 1 and 3 digits, and it removes the `+` and the first 1-3 digits.
    const phnrw = req.body.phone.replace(/^\+\d{1,3}/, "");

    // Reference to the customer's Firestore document
    const customerDocRef = doc(firestore, "customers", id.toString());

    try {
      // Check if the customer document exists
      const customerDocSnapshot = await getDoc(customerDocRef);
      if (customerDocSnapshot.exists()) {
        // Update the customer's phone information
        await setDoc(
          customerDocRef,
          {
            phn: phn,
            phnrw: phnrw,
          },
          { merge: true } // Use merge to update only the specified fields
        );
      } else {
        console.error(
          `Customer document for id ${id} does not exist in Firestore.`
        );
      }
    } catch (error) {
      console.error("Error updating Firestore:", error);
      throw new Error("Failed to update Firestore with the new phone number.");
    }
  }

  // Clean up the response
  updatedUser.id = Number(updatedUser.id);
  updatedUser.role_id = Number(updatedUser.role_id);
  updatedUser.role = {
    name: updatedUser.role,
  };
  updatedUser.commercial_id = Number(updatedUser.commercial_id);

  return new SuccessMsgDataResponse(
    updatedUser,
    "User updated successfully"
  ).send(res);
});

exports.createMobileUser = asyncHandler(async (req, res) => {
  const { id, role } = req.body; // Extract data
  const roleLowered = role.toLowerCase(); // Convert role to lowercase

  // Validate the necessary data
  if (!id) {
    return res.status(400).json({
      message: "Missing required field: id",
    });
  }
  if (!roleLowered) {
    return res.status(400).json({
      message: "Missing required field: type",
    });
  }
  if (roleLowered !== "agent" && roleLowered !== "customer") {
    return res.status(400).json({
      message: "Invalid user type",
    });
  }

  try {
    // Fetch user data from the database
    const user = await prisma.users.findUnique({
      where: {
        id: parseInt(id),
      },
    });

    if (!user) {
      console.error("User not found");
      return res.status(404).json({
        message: "User not found",
      });
    }

    console.log("Fetched user:", user);

    // Parse the phone number
    const parsedPhone = parsePhoneNumberFromString(user.phone);
    if (!parsedPhone) {
      return res.status(400).json({
        message: "Invalid phone number",
      });
    }

    const countryCode = `+${parsedPhone.countryCallingCode}`;
    const rawPhone = parsedPhone.nationalNumber;

    const photoUrl = user.profile_pic || "";

    // Attempt to create a mobile user
    const result = await createMobileUserUtils({
      id,
      nickname: `${user.first_name} ${user.last_name}`,
      phone: rawPhone,
      phoneWithCountryCode: user.phone,
      countryCode,
      photoUrl,
      roleLowered,
    });

    if (result.success) {
      // Update has_mobile_account in the users table
      await prisma.users.update({
        where: {
          id: parseInt(id),
        },
        data: {
          has_mobile_account: true,
        },
      });

      res.status(201).json({
        message: `${role} created successfully`,
        agentId: result.id,
      });
    } else {
      res.status(500).json({
        message: "Failed to create user",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Error creating mobile user:", error);
    res.status(500).json({
      message: "Failed to create user",
      error: error.message,
    });
  }
});

exports.fetchRoles = asyncHandler(async (req, res) => {
  const roles = await prisma.roles.findMany();
  const rolesWithNumericId = roles.map((role) => ({
    ...role,
    id: Number(role.id),
  }));
  return new SuccessResponse(rolesWithNumericId).send(res);
});

exports.updateUserActivationStatus = asyncHandler(async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      message: "User ID is missing.",
    });
  }

  try {
    // Attempt to update the user's status
    const user = await prisma.users.update({
      where: {
        id: parseInt(id),
      },
      data: {
        status: true,
      },
    });

    // Parse the phone number
    const parsedPhone = parsePhoneNumberFromString(user.phone);
    if (!parsedPhone) {
      return res.status(400).json({
        message: "Invalid phone number",
      });
    }

    const countryCode = `+${parsedPhone.countryCallingCode}`;
    const rawPhone = parsedPhone.nationalNumber;

    // Call createMobileUser after updating user status
    const result = await createMobileUserUtils({
      id: user.id.toString(),
      nickname: `${user.first_name} ${user.last_name}`,
      phone: rawPhone,
      phoneWithCountryCode: user.phone,
      countryCode: countryCode,
      photoUrl: user.profile_pic,
      roleLowered: "customer",
    });

    if (result.success) {
      await prisma.users.update({
        where: {
          id: parseInt(id),
        },
        data: {
          has_mobile_account: true,
        },
      });
      // Send activation email as the last step
      const templatePath = "templates/email/account-activated.html";
      await queueEmail({
        emails: [user.email],
        subject:
          "Votre compte a été activé et votre compte mobile créé avec succès",
        templatePath: templatePath,
      });

      const customerNotification = {
        xa1: user.id.toString(),
        xa2: "Votre compte a été créé avec succès",
        xa3: `Votre compte a été créé avec succès , bienvenue sur notre plateforme.`,
        xa5: "",
        xa9: `${user.email}`,
        xd1: admin.firestore.Timestamp.now().toMillis(), // Set xd1 to current timestamp in milliseconds
        xf4: false, // Assuming this field needs to be set to false initially
      };

      const agentNotification = {
        xa1: user.id.toString(),
        xa2: "Nouvel utilisateur ajouté",
        xa3: `Un nouvel utilisateur (${user.first_name} ${user.last_name}) a été ajouté à la plateforme.`,
        xa5: "",
        xa9: `${user.email}`,
        xd1: admin.firestore.Timestamp.now().toMillis(), // Set xd1 to current timestamp in milliseconds
        xf4: false, // Assuming this field needs to be set to false initially
      };

      // Reference to the customer's customernotifications document
      const customerNotificationsDocRef = doc(
        db,
        "customers",
        user.id.toString(),
        "customernotifications",
        "customernotifications"
      );
      // Reference to the agent's agentnotifications document
      const agentNotificationsDocRef = doc(db, "userapp", "agentnotifications");

      // Check if the customer notifications document exists
      const customerDocSnapshot = await getDoc(customerNotificationsDocRef);
      if (customerDocSnapshot.exists()) {
        // Append the new notifications to the customer's list
        await setDoc(
          customerNotificationsDocRef,
          {
            list: arrayUnion(customerNotification),
          },
          {
            merge: true,
          }
        ); // Use merge to update only the specified fields
      }

      // Check if the agent notifications document exists
      const agentDocSnapshot = await getDoc(agentNotificationsDocRef);
      if (agentDocSnapshot.exists()) {
        // Append the new notifications to the agent's list
        await setDoc(
          agentNotificationsDocRef,
          {
            list: arrayUnion(agentNotification),
          },
          {
            merge: true,
          }
        ); // Use merge to update only the specified fields
      }

      return res.status(200).json({
        status: "success",
        message: "User status updated and mobile user created successfully.",
        agentId: result.id,
      });
    } else {
      return res.status(500).json({
        status: "fail",
        message: "User status updated but failed to create mobile user.",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Failed to update user status:", error);
    return res.status(500).json({
      status: "fail",
      message: "Failed to update user status.",
    });
  }
});

function groupData(data, groupBy, sumField = null) {
  const grouped = {};
  const months = Array.from({ length: 12 }, (_, i) => i + 1); // [1, 2, ..., 12]

  // Initialize each month with a default value
  months.forEach((month) => {
    grouped[month] = { label: month, count: 0, sum: 0 };
  });

  data.forEach((item) => {
    const date = new Date(item.created_at);
    const key = date.getMonth() + 1;

    grouped[key].count += 1;
    if (sumField) {
      grouped[key].sum += parseFloat(item[sumField]);
    }
  });

  return Object.values(grouped);
}

function getMarketFilter(market) {
  switch (market) {
    case "Tunisie":
      return { user: { country: "TN" } };
    case "Maroc":
      return { user: { country: "MA" } };
    case "Europe":
      return { user: { country: { notIn: ["TN", "MA"] } } };
    default:
      return {};
  }
}

exports.getPractitionersPatientsData = async (req, res) => {
  try {
    const { market, startDate, endDate, groupBy = "month" } = req.query;

    const marketFilter = getMarketFilter(market);

    const currentDate = new Date();
    const defaultStartDate = new Date(currentDate.getFullYear(), 0, 1);
    const defaultEndDate = new Date(currentDate.getFullYear(), 11, 31);

    const dateFilter = {
      gte: startDate ? new Date(startDate) : defaultStartDate,
      lt: endDate ? new Date(endDate) : defaultEndDate,
    };

    const practitionersData = await prisma.doctors.findMany({
      where: {
        created_at: dateFilter,
        ...marketFilter,
      },
    });

    const patientsData = await prisma.patients.findMany({
      where: {
        created_at: dateFilter,
        doctor: marketFilter,
      },
    });

    const groupedPractitioners = groupData(practitionersData, groupBy);
    const groupedPatients = groupData(patientsData, groupBy);

    const totalPractitioners = practitionersData.length;
    const totalPatients = patientsData.length;

    res.status(200).json({
      practitioners: groupedPractitioners,
      patients: groupedPatients,
      totalPractitioners,
      totalPatients,
    });
  } catch (error) {
    console.error("Error fetching practitioners and patients data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getCasesSummaryData = async (req, res) => {
  try {
    const { market, startDate, endDate, groupBy = "month" } = req.query;

    const marketFilter = getMarketFilter(market);

    const currentDate = new Date();
    const defaultStartDate = new Date(currentDate.getFullYear(), 0, 1);
    const defaultEndDate = new Date(currentDate.getFullYear(), 11, 31);

    const dateFilter = {
      gte: startDate ? new Date(startDate) : defaultStartDate,
      lt: endDate ? new Date(endDate) : defaultEndDate,
    };

    // Fetch finitions data
    const finitionsData = await prisma.cases.findMany({
      where: {
        case_type: "R",
        created_at: dateFilter,
        doctor: {
          is: {
            user: {
              country: marketFilter?.user?.country || {},
            },
          },
        },
      },
    });

    // Fetch cases that could be validated
    const potentialValidatedCasesData = await prisma.cases.findMany({
      where: {
        case_type: "N",
        created_at: dateFilter,
        doctor: {
          is: {
            user: {
              country: marketFilter?.user?.country || {},
            },
          },
        },
      },
      include: {
        status_histories: {
          orderBy: {
            created_at: "desc",
          },
          take: 1,
        },
      },
    });

    // Filter out cases with disallowed statuses
    const validatedCasesData = potentialValidatedCasesData.filter(
      (caseItem) => {
        const lastStatus = caseItem.status_histories[0]?.name;
        return !["incomplete", "needs_approval", "pending"].includes(
          lastStatus
        );
      }
    );

    // Fetch refused cases data
    const refusedCasesData = await prisma.cases.findMany({
      where: {
        is_refused: 1,
        created_at: dateFilter,
        doctor: {
          is: {
            user: {
              country: marketFilter?.user?.country || {},
            },
          },
        },
      },
    });

    const groupedFinitions = groupData(finitionsData, groupBy);
    const groupedValidatedCases = groupData(validatedCasesData, groupBy);
    const groupedRefusedCases = groupData(refusedCasesData, groupBy);

    const totalFinitions = finitionsData.length;
    const totalValidatedCases = validatedCasesData.length;
    const totalRefusedCases = refusedCasesData.length;

    res.status(200).json({
      finitions: groupedFinitions,
      validatedCases: groupedValidatedCases,
      refusedCases: groupedRefusedCases,
      totalFinitions,
      totalValidatedCases,
      totalRefusedCases,
    });
  } catch (error) {
    console.error("Error fetching cases summary data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getSmilesetData = async (req, res) => {
  try {
    const { market, startDate, endDate, groupBy = "month" } = req.query;

    const marketMapping = {
      all: {},
      Tunisie: { user: { country: "TN" } },
      Maroc: { user: { country: "MA" } },
      Europe: {
        user: {
          country: {
            notIn: ["TN", "MA"],
          },
        },
      },
    };

    const marketFilter = marketMapping[market] || {};

    const currentDate = new Date();
    const defaultStartDate = new Date(currentDate.getFullYear(), 0, 1);
    const defaultEndDate = new Date(currentDate.getFullYear(), 11, 31);

    const dateFilter = {
      gte: startDate ? new Date(startDate) : defaultStartDate,
      lt: endDate ? new Date(endDate) : defaultEndDate,
    };

    const smilesetData = await prisma.labo_links.findMany({
      where: {
        created_at: dateFilter,
        case: {
          doctor: {
            ...marketFilter,
          },
        },
      },
    });

    const groupedSmileset = groupData(smilesetData, groupBy);
    const totalSmilesetLinks = smilesetData.length;

    res.status(200).json({
      smilesetLinks: groupedSmileset,
      totalSmilesetLinks,
    });
  } catch (error) {
    console.error("Error fetching smileset data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPacksData = async (req, res) => {
  try {
    const { market, startDate, endDate } = req.query;

    // Define market filters similar to the corrected Smileset function
    const marketMapping = {
      all: {},
      Tunisie: { country: "TN" },
      Maroc: { country: "MA" },
      Europe: {
        country: {
          notIn: ["TN", "MA"],
        },
      },
    };

    const marketFilter = marketMapping[market] || {};

    const currentDate = new Date();
    const defaultStartDate = new Date(currentDate.getFullYear(), 0, 1);
    const defaultEndDate = new Date(currentDate.getFullYear(), 11, 31);

    const dateFilter = {
      gte: startDate ? new Date(startDate) : defaultStartDate,
      lt: endDate ? new Date(endDate) : defaultEndDate,
    };

    // Query directly from cases table
    const casesData = await prisma.cases.findMany({
      where: {
        created_at: dateFilter,
        doctor: {
          user: marketFilter, // Use the market filter directly
        },
      },
      select: {
        pack_id: true, // Assuming 'pack_id' is the foreign key for the pack
      },
    });

    // Fetch all packs to map the pack_id to the pack name
    const packs = await prisma.packs.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    const packMap = packs.reduce((acc, pack) => {
      acc[pack.id] = pack.name;
      return acc;
    }, {});

    // Grouping cases by pack name
    const groupedPacks = casesData.reduce((acc, { pack_id }) => {
      const packName = packMap[pack_id];
      if (packName) {
        // Ensure only valid packs are included
        acc[packName] = acc[packName] || { name: packName, value: 0 };
        acc[packName].value += 1;
      }
      return acc;
    }, {});

    const totalPacks = Object.values(groupedPacks).reduce(
      (acc, pack) => acc + pack.value,
      0
    );

    res.status(200).json({
      packs: Object.values(groupedPacks),
      totalPacks,
    });
  } catch (error) {
    console.error("Error fetching packs data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getInvoiceStatistics = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = "month", market } = req.query;

    const dateFilter = {
      gte: startDate
        ? new Date(startDate)
        : new Date(new Date().getFullYear(), 0, 1),
      lt: endDate
        ? new Date(endDate)
        : new Date(new Date().getFullYear(), 11, 31),
    };

    // Mapping full country names to their corresponding country codes
    const marketMapping = {
      Tunisie: "TN",
      Maroc: "MA",
    };

    let marketFilter = {};

    if (market === "Europe") {
      // Fetch all except Tunisia and Morocco
      marketFilter = {
        country_code: {
          notIn: ["TN", "MA"],
        },
      };
    } else if (market && market !== "all") {
      // Apply specific market filter
      const countryCode = marketMapping[market] || market;
      marketFilter = { country_code: countryCode };
    }

    const paidInvoices = await prisma.invoices.findMany({
      where: {
        payment_status: "fully_paid",
        created_at: dateFilter,
        ...marketFilter, // Apply market filter
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    const partiallyPaidInvoices = await prisma.invoices.findMany({
      where: {
        payment_status: "partially_paid",
        created_at: dateFilter,
        ...marketFilter, // Apply market filter
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    const unpaidInvoices = await prisma.invoices.findMany({
      where: {
        payment_status: "unpaid",
        created_at: dateFilter,
        ...marketFilter, // Apply market filter
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    const groupedPaidInvoices = groupData(paidInvoices, groupBy);
    const groupedPartiallyPaidInvoices = groupData(
      partiallyPaidInvoices,
      groupBy
    );
    const groupedUnpaidInvoices = groupData(unpaidInvoices, groupBy);

    res.status(200).json({
      paidInvoices: groupedPaidInvoices,
      partiallyPaidInvoices: groupedPartiallyPaidInvoices,
      unpaidInvoices: groupedUnpaidInvoices,
      totalPaidInvoices: paidInvoices.length,
      totalPartiallyPaidInvoices: partiallyPaidInvoices.length,
      totalUnpaidInvoices: unpaidInvoices.length,
    });
  } catch (error) {
    console.error("Error fetching invoice statistics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getTotalDueByMarket = async (req, res) => {
  try {
    const { startDate, endDate, market } = req.query;

    const dateFilter = {
      gte: startDate
        ? new Date(startDate)
        : new Date(new Date().getFullYear(), 0, 1),
      lt: endDate
        ? new Date(endDate)
        : new Date(new Date().getFullYear(), 11, 31),
    };

    // Define market mapping
    const marketMapping = {
      TN: "TN",
      MA: "MA",
      EUR: ["TN", "MA"], // Exclude these regions for EUR
    };

    let countryCodeFilter;

    if (market === "EUR") {
      countryCodeFilter = {
        country_code: {
          notIn: marketMapping.EUR,
        },
      };
    } else {
      countryCodeFilter = {
        country_code: marketMapping[market],
      };
    }

    const totalDue = await prisma.invoices.findMany({
      where: {
        created_at: dateFilter,
        ...countryCodeFilter,
        payment_status: "unpaid",
      },
      select: {
        amount: true,
        created_at: true,
      },
    });

    // Group by month and calculate the total amount
    const groupedByMonth = totalDue.reduce((acc, invoice) => {
      const month = invoice.created_at.getMonth() + 1; // Month from 1 to 12
      if (!acc[month]) {
        acc[month] = 0;
      }
      acc[month] += parseFloat(invoice.amount);
      return acc;
    }, {});

    const formattedData = Object.keys(groupedByMonth).map((month) => ({
      label: month,
      amount: groupedByMonth[month],
    }));

    res.status(200).json({ region: market, data: formattedData });
  } catch (error) {
    console.error("Error fetching total due by market:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getTopClients = async (req, res) => {
  try {
    const { market } = req.query; // Get the market filter from the query parameters

    // Fetch all cases with their associated invoices and doctor information
    const cases = await prisma.cases.findMany({
      select: {
        id: true,
        doctor: {
          select: {
            id: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
                profile_pic: true,
                country: true, // Assuming this field exists
              },
            },
          },
        },
        invoices: {
          select: {
            amount: true,
          },
        },
      },
    });

    // Filter cases based on the market
    const filteredCases = cases.filter((caseData) => {
      const country = caseData.doctor?.user?.country;
      if (market === "tunisie") {
        return country === "TN";
      } else if (market === "maroc") {
        return country === "MA";
      } else if (market === "europe") {
        return country !== "TN" && country !== "MA";
      }
      // If market is 'total' or not specified, return all cases
      return true;
    });

    // Aggregate the data by doctor
    const aggregatedData = filteredCases.reduce((acc, caseData) => {
      const doctor = caseData.doctor;
      const totalAmountDue = caseData.invoices.reduce(
        (sum, invoice) => sum + parseFloat(invoice.amount || 0),
        0
      );

      // Determine the currency based on the doctor's country
      let currency = "EUR"; // Default currency
      if (doctor?.user?.country === "TN") {
        currency = "TND";
      } else if (doctor?.user?.country === "MA") {
        currency = "DRH";
      }

      // If the doctor is not already in the accumulator, add them
      if (!acc[doctor.id]) {
        acc[doctor.id] = {
          id: doctor.id.toString(),
          name: doctor.user.first_name + " " + doctor.user.last_name,
          email: doctor.user.email,
          avatar: doctor.user.profile_pic,
          totalAmountDue: 0,
          currency: currency,
        };
      }

      // Accumulate the total amount due for the doctor
      acc[doctor.id].totalAmountDue += totalAmountDue;

      return acc;
    }, {});

    // Convert the aggregated data to an array, format the amounts with currency, and sort by total amount
    const result = Object.values(aggregatedData)
      .map((doctor) => ({
        ...doctor,
        totalAmountDue: `${doctor.totalAmountDue.toFixed(2)} ${
          doctor.currency
        }`,
      }))
      .sort(
        (a, b) => parseFloat(b.totalAmountDue) - parseFloat(a.totalAmountDue)
      ) // Sort by total amount in descending order
      .slice(0, 10); // Take the top 10 clients

    // Return the result
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching top clients:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getInternalStatistics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Fetch the relevant status histories using raw query with safe date parameters
    const statusHistories = await prisma.$queryRaw`
      SELECT
        s.caseId,
        s.name AS status,
        s.created_at
      FROM
        status_histories s
      WHERE
        s.created_at BETWEEN ${
          startDate
            ? new Date(startDate)
            : new Date(new Date().getFullYear(), 0, 1)
        } AND ${
      endDate ? new Date(endDate) : new Date(new Date().getFullYear(), 11, 31)
    }
    `;

    // Group by caseId
    const groupedByCaseId = statusHistories.reduce((acc, curr) => {
      const key = curr.caseId;
      if (!acc[key]) acc[key] = {};
      acc[key][curr.status] = curr.created_at;
      return acc;
    }, {});

    // Calculate the average delays for each month
    const result = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      let totalConceptionDelay = 0;
      let totalValidationDelay = 0;
      let totalFabricationDelay = 0;
      let count = 0;

      for (const key in groupedByCaseId) {
        const record = groupedByCaseId[key];
        const recordMonth = new Date(record.pending).getMonth() + 1;

        if (recordMonth === month) {
          const conceptionDelay =
            record["needs_approval"] && record["pending"]
              ? (new Date(record["needs_approval"]) -
                  new Date(record["pending"])) /
                3600000
              : 0;
          const validationDelay =
            record["in_construction"] && record["needs_approval"]
              ? (new Date(record["in_construction"]) -
                  new Date(record["needs_approval"])) /
                3600000
              : 0;
          const fabricationDelay =
            record["redesign_requested"] && record["in_construction"]
              ? (new Date(record["redesign_requested"]) -
                  new Date(record["in_construction"])) /
                3600000
              : 0;

          totalConceptionDelay += conceptionDelay;
          totalValidationDelay += validationDelay;
          totalFabricationDelay += fabricationDelay;
          count++;
        }
      }

      return {
        month,
        avg_conception_delay: count > 0 ? totalConceptionDelay / count : 0,
        avg_validation_delay: count > 0 ? totalValidationDelay / count : 0,
        avg_fabrication_delay: count > 0 ? totalFabricationDelay / count : 0,
      };
    });

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching internal statistics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getNumbersOverview = async (req, res) => {
  try {
    const { startDate, endDate, market } = req.query;

    // Validate the date range
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Invalid date range provided" });
    }

    // Parse the start and end dates
    const parsedStartDate = new Date(startDate);
    let parsedEndDate = new Date(endDate);

    // Ensure valid dates
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    // Include the full day for the end date
    parsedEndDate.setHours(23, 59, 59, 999);

    // Define market filters
    const marketMapping = {
      tunisia: { country: "TN" },
      morocco: { country: "MA" },
      europe: {
        country: {
          notIn: ["TN", "MA"],
        },
      },
    };

    const newPractitioners = {};
    const newCases = {};
    const numOrderedCases = {};
    const numRenumeratedCases = {};
    const numRejectedCases = {};
    const numManufacturedCases = {};

    if (market === "total") {
      for (const [key, value] of Object.entries(marketMapping)) {
        newPractitioners[key] = await prisma.doctors.count({
          where: {
            created_at: {
              gte: parsedStartDate,
              lte: parsedEndDate,
            },
            user: {
              ...value,
            },
          },
        });

        newCases[key] = await prisma.cases.count({
          where: {
            created_at: {
              gte: parsedStartDate,
              lte: parsedEndDate,
            },
            doctor: {
              user: {
                ...value,
              },
            },
          },
        });

        numOrderedCases[key] = await prisma.cases.count({
          where: {
            created_at: {
              gte: parsedStartDate,
              lte: parsedEndDate,
            },
            case_type: "C",
            doctor: {
              user: {
                ...value,
              },
            },
          },
        });

        numRenumeratedCases[key] = await prisma.cases.count({
          where: {
            created_at: {
              gte: parsedStartDate,
              lte: parsedEndDate,
            },
            case_type: "R",
            doctor: {
              user: {
                ...value,
              },
            },
          },
        });

        numRejectedCases[key] = await prisma.cases.count({
          where: {
            created_at: {
              gte: parsedStartDate,
              lte: parsedEndDate,
            },
            is_refused: 1,
            doctor: {
              user: {
                ...value,
              },
            },
          },
        });

        numManufacturedCases[key] = await prisma.cases.count({
          where: {
            created_at: {
              gte: parsedStartDate,
              lte: parsedEndDate,
            },
            status_histories: {
              some: {
                name: {
                  notIn: [
                    "incomplete",
                    "pending",
                    "needs_approval",
                    "in_construction",
                  ],
                },
              },
            },
            doctor: {
              user: {
                ...value,
              },
            },
          },
        });
      }

      const chiffreAffairesTunisia = await prisma.invoices.aggregate({
        _sum: {
          amount: true,
        },
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          case: {
            doctor: {
              user: {
                country: "TN",
              },
            },
          },
        },
      });

      const chiffreAffairesMorocco = await prisma.invoices.aggregate({
        _sum: {
          amount: true,
        },
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          case: {
            doctor: {
              user: {
                country: "MA",
              },
            },
          },
        },
      });

      const chiffreAffairesEurope = await prisma.invoices.aggregate({
        _sum: {
          amount: true,
        },
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          case: {
            doctor: {
              user: {
                country: {
                  notIn: ["TN", "MA"],
                },
              },
            },
          },
        },
      });

      res.status(200).json({
        newPractitionersTunisia: newPractitioners.tunisia,
        newPractitionersMorocco: newPractitioners.morocco,
        newPractitionersEurope: newPractitioners.europe,
        newCasesTunisia: newCases.tunisia,
        newCasesMorocco: newCases.morocco,
        newCasesEurope: newCases.europe,
        numOrderedCasesTunisia: numOrderedCases.tunisia,
        numOrderedCasesMorocco: numOrderedCases.morocco,
        numOrderedCasesEurope: numOrderedCases.europe,
        numRenumeratedCasesTunisia: numRenumeratedCases.tunisia,
        numRenumeratedCasesMorocco: numRenumeratedCases.morocco,
        numRenumeratedCasesEurope: numRenumeratedCases.europe,
        numRejectedCasesTunisia: numRejectedCases.tunisia,
        numRejectedCasesMorocco: numRejectedCases.morocco,
        numRejectedCasesEurope: numRejectedCases.europe,
        numManufacturedCasesTunisia: numManufacturedCases.tunisia,
        numManufacturedCasesMorocco: numManufacturedCases.morocco,
        numManufacturedCasesEurope: numManufacturedCases.europe,
        chiffreAffairesTunisia: chiffreAffairesTunisia._sum.amount || 0,
        chiffreAffairesMorocco: chiffreAffairesMorocco._sum.amount || 0,
        chiffreAffairesEurope: chiffreAffairesEurope._sum.amount || 0,
      });
    } else {
      const marketFilter = marketMapping[market] || {};

      const newPractitioners = await prisma.doctors.count({
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          user: {
            ...marketFilter,
          },
        },
      });

      const newCases = await prisma.cases.count({
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          doctor: {
            user: {
              ...marketFilter,
            },
          },
        },
      });

      const numOrderedCases = await prisma.cases.count({
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          case_type: "C",
          doctor: {
            user: {
              ...marketFilter,
            },
          },
        },
      });

      const numRenumeratedCases = await prisma.cases.count({
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          case_type: "R",
          doctor: {
            user: {
              ...marketFilter,
            },
          },
        },
      });

      const numRejectedCases = await prisma.cases.count({
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          is_refused: 1,
          doctor: {
            user: {
              ...marketFilter,
            },
          },
        },
      });

      const numManufacturedCases = await prisma.cases.count({
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          status_histories: {
            every: {
              name: {
                notIn: [
                  "incomplete",
                  "pending",
                  "needs_approval",
                  "in_construction",
                ],
              },
            },
          },
          doctor: {
            user: {
              ...marketFilter,
            },
          },
        },
      });

      const chiffreAffaires = await prisma.invoices.aggregate({
        _sum: {
          amount: true,
        },
        where: {
          created_at: {
            gte: parsedStartDate,
            lte: parsedEndDate,
          },
          case: {
            doctor: {
              user: {
                ...marketFilter,
              },
            },
          },
        },
      });

      res.status(200).json({
        newPractitioners,
        newCases,
        numOrderedCases,
        numRenumeratedCases,
        numRejectedCases,
        numManufacturedCases,
        chiffreAffaires: chiffreAffaires._sum.amount || 0,
      });
    }
  } catch (error) {
    console.error("Error fetching numbers overview:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


// Add a new device code (auto-generated)
exports.addCodeInDevice = asyncHandler(async (req, res) => {
  try {
    const { case_id } = req.body; // Extract case_id from the request body

    // Check if the case_id exists in the cases table
    const existingCase = await prisma.cases.findUnique({
      where: { id: BigInt(case_id) },
    });

    if (!existingCase) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid case_id. Case not found.",
      });
    }

    // Check if a device already exists for the given case_id
    const existingDeviceForCase = await prisma.device.findFirst({
      where: { case_id: BigInt(case_id) },
    });

    if (existingDeviceForCase) {
      return res.status(400).json({
        status: "fail",
        message: "A device code has already been created for this case_id.",
      });
    }
    // Generate a unique code (e.g., random alphanumeric string with case_id)
    const generateCode = () => {
      return Math.random().toString(36).substr(2, 9); // Example: 'case_123_device_abcd1234'
    };

    let code = generateCode();

    // Ensure the generated code is unique by checking the device table
    let existingDevice = await prisma.device.findUnique({
      where: { code },
    });

    // Keep generating until a unique code is found
    while (existingDevice) {
      code = generateCode();
      existingDevice = await prisma.device.findUnique({
        where: { code },
      });
    }

    // Generate the QR code image in Base64 format
    const qrImageBase64 = await QRCode.toDataURL(code);

    // Insert new device with the generated code and case_id
    const newDevice = await prisma.device.create({
      data: {
        code: code,
        case_id: case_id, // Set the case_id
        assigned: false, // Set the initial assigned value to false (0)
        qr_image: qrImageBase64, // Save the QR image as Base64
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    const serializedNewDevice = {
      ...newDevice,
      id: Number(newDevice.id),
      case_id: Number(newDevice.case_id),
    };

    // Return success response
    res.status(201).json({
      status: "success",
      data: {
        device: serializedNewDevice,
      },
    });
  } catch (error) {
    console.error("Error generating and adding device code:", error);
    res
      .status(500)
      .json({ status: "fail", message: "Failed to generate device code" });
  }
});