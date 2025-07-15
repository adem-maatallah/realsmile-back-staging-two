const { PrismaClient, Prisma } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());

const { BadRequestError } = require("../middlewares/apiError");
const { SuccessResponse } = require("../middlewares/apiResponse");

const bcrypt = require("bcryptjs");
const { uploadDoctorProfilePic } = require("../utils/googleCDN");
const { statusMap } = require("../enums/caseEnum");
const queueEmail = require("./../utils/email");

const accountSid = process.env.TWILIO_TEST_ACCOUNT_SID;
const authToken = process.env.TWILIO_TEST_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

exports.getAll = async (req, res) => {
  try {
    let doctorsQuery = {
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            profile_pic: true,
            status: true,
            country: true,
            created_at: true,
            commercial_id: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    };

    if (req.user.role === "commercial") {
      doctorsQuery.where = {
        user: {
          commercial_id: req.user.id,
        },
      };
    }

    if (req.query.isMobile === "true") {
      doctorsQuery.where = {
        ...doctorsQuery.where,
        user: {
          has_mobile_account: true,
        },
      };
    }

    // Fetch all doctors in a single query
    const doctors = await prisma.doctors.findMany(doctorsQuery);
    if (doctors.length === 0) {
      return res.status(200).json({
        message: "Success",
        doctors: [],
      });
    }

    const doctorIds = doctors.map((doctor) => doctor.id);

    // Fetch invoices with related partial payments for all doctors in a single query
    const invoices = await prisma.invoices.findMany({
      where: {
        case: {
          doctor_id: { in: doctorIds },
        },
      },
      include: {
        partial_payments: true,
        case: {
          select: {
            doctor_id: true,
          },
        },
      },
    });

    // Calculate total paid, unpaid, and total amounts for each doctor using reduce for better performance
    const paymentsMap = invoices.reduce((acc, invoice) => {
      if (!invoice.case) return acc;

      const doctorId = invoice.case.doctor_id;
      const invoiceAmount = parseFloat(invoice.amount);
      const totalPaidForInvoice = invoice.partial_payments.reduce(
        (sum, payment) => sum + parseFloat(payment.amount),
        0
      );

      if (!acc[doctorId]) {
        acc[doctorId] = {
          total_paid: 0,
          total_unpaid: 0,
          total_amount: 0,
        };
      }

      acc[doctorId].total_paid += totalPaidForInvoice;
      acc[doctorId].total_unpaid += invoiceAmount - totalPaidForInvoice;
      acc[doctorId].total_amount += invoiceAmount;

      return acc;
    }, {});

    // Map doctor data and add the calculated payment information
    const returned_doctors = doctors.map((doctor) => {
      const payments = paymentsMap[doctor.id] || {
        total_paid: 0,
        total_unpaid: 0,
        total_amount: 0,
      };

      const currency =
        doctor.user.country === "TN"
          ? "TND"
          : doctor.user.country === "MA"
          ? "MAD"
          : "EUR";

      return {
        id: doctor.user.id.toString(),
        first_name: doctor.user.first_name,
        last_name: doctor.user.last_name,
        email: doctor.user.email,
        phone: doctor.user.phone,
        profile_pic: doctor.user.profile_pic,
        country: doctor.user.country,
        city: doctor.city,
        status: doctor.user.status ? "activé" : "désactivé",
        created_at: doctor.user.created_at,
        total_paid: payments.total_paid.toFixed(2),
        total_unpaid: payments.total_unpaid.toFixed(2),
        total_amount: payments.total_amount.toFixed(2),
        currency: currency,
      };
    });

    return res.status(200).json({
      message: "Success",
      doctors: returned_doctors,
    });
  } catch (error) {
    console.error("Error fetching doctors: ", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

exports.createDoctor = async (req, res, next) => {
  try {
    const {
      first_name,
      last_name,
      email,
      password,
      speciality,
      address,
      address_2,
      city,
      zip,
      country,
    } = req.body;
    let { phone, office_phone } = req.body;

    const profilePictureFile = req.file; // Handle file uploads with multer or similar middleware

    // Remove spaces from phone numbers if they exist
    if (phone) {
      phone = phone.replace(/\s/g, "");
    }

    if (office_phone) {
      office_phone = office_phone.replace(/\s/g, "");
    }

    // Check if user already exists
    const existingUser = await prisma.users.findFirst({
      where: {
        OR: [{ email: email }, { phone: phone }],
      },
    });

    if (existingUser) {
      throw new BadRequestError(
        "A user with this email or phone already exists"
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Get doctor role
    const role = await prisma.roles.findUnique({
      where: { name: "doctor" },
    });
    if (!role) {
      throw new Error("Doctor role not found");
    }

    // Handle profile picture
    let imageUrl = null;
    if (profilePictureFile) {
      imageUrl = await uploadDoctorProfilePic(
        profilePictureFile,
        process.env.GOOGLE_STORAGE_BUCKET_PROFILE_PICS
      );
    } else {
      imageUrl =
        "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";
    }

    // Create user
    const newUser = await prisma.users.create({
      data: {
        first_name,
        last_name,
        user_name: `${first_name}_${last_name}_${Date.now()}`,
        email,
        country,
        password: hashedPassword,
        role_id: role.id,
        status: false,
        phone,
        profile_pic: imageUrl,
        created_at: new Date(),
        phone_verified: true,
      },
    });

    // Create doctor
    await prisma.doctors.create({
      data: {
        user_id: newUser.id,
        speciality,
        office_phone,
        address,
        address_2,
        city,
        zip,
      },
    });

    // Send welcome email
    const templatePath = "templates/email/new-account.html";
    await queueEmail({
      emails: [newUser.email],
      subject: "Bienvenue sur Realsmile",
      templatePath: templatePath,
    });

    return new SuccessResponse(
      "Account created successfully, please wait for the admin validation."
    ).send(res);
  } catch (error) {
    next(error);
  }
};

exports.doctorCaseStatistics = async (req, res) => {
  const userId = parseInt(req.user.id);

  try {
    const doctor = await prisma.doctors.findUnique({
      where: {
        user_id: userId,
      },
    });

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    const cases = await prisma.cases.findMany({
      where: {
        doctor_id: doctor.id,
      },
      include: {
        patient: true, // Assuming 'date_of_birth' and 'gender' are here
        status_histories: {
          orderBy: {
            created_at: "desc",
          },
          take: 1,
        },
      },
    });

    const filteredCases = cases.filter(
      (caseItem) => caseItem.status_histories[0]?.name === "needs_approval"
    );

    let statusCounts = {
      totalCases: cases.length,

      incomplete: 0,
      pending: 0,
      redesign_requested: 0,
      complete: 0,
      in_construction: 0,
      in_treatment: 0,
      needs_approval: 0,
      on_hold: 0,
    };

    let ageGroups = {
      "0-18": {
        Homme: 0,
        Femme: 0,
      },
      "19-35": {
        Homme: 0,
        Femme: 0,
      },
      "36-55": {
        Homme: 0,
        Femme: 0,
      },
      "56-75": {
        Homme: 0,
        Femme: 0,
      },
      "76+": {
        Homme: 0,
        Femme: 0,
      },
    };

    const currentYear = new Date().getFullYear();
    cases.forEach((caseItem) => {
      const latestStatus = caseItem.status_histories[0]?.name;
      if (latestStatus && statusCounts.hasOwnProperty(latestStatus)) {
        statusCounts[latestStatus]++;
      }

      // Calculate age and increment gender-specific age group count
      if (caseItem.patient.date_of_birth && caseItem.patient.gender) {
        const birthYear = new Date(
          caseItem.patient.date_of_birth
        ).getFullYear();
        const age = currentYear - birthYear;
        const ageKey =
          age <= 18
            ? "0-18"
            : age <= 35
            ? "19-35"
            : age <= 55
            ? "36-55"
            : age <= 75
            ? "56-75"
            : "76+";

        const gender =
          caseItem.patient.gender.toLowerCase() === "homme" ? "Homme" : "Femme";
        ageGroups[ageKey][gender]++;
      }
    });
    const latestCases = filteredCases
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) // Sort cases by created_at in descending order
      .slice(0, 10) // Take the first 10 cases after sorting
      .map((caseItem) => ({
        patient: {
          first_name: caseItem.patient.first_name,
          last_name: caseItem.patient.last_name,
        },
        status: caseItem.status_histories[0]?.name,
        pack_id: caseItem.pack_id?.toString(),
        created_at: caseItem.created_at,
      }));

    res.json({
      statusCounts,
      ageGroups,
      latestCases,
    });
  } catch (error) {
    console.error("Error fetching case details:", error);
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

exports.sendOtp = async (req, res, next) => {
  const { phone } = req.body;

  try {
    // Check if a user with this phone number exists
    const user = await prisma.users.findUnique({
      where: {
        phone: phone,
      },
    });

    if (user) {
      return res.status(404).json({ message: "User already exists" });
    }

    // Send OTP via Twilio
    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    if (verification.status === "pending") {
      return res.status(200).json({ message: "OTP sent successfully" });
    } else {
      throw new Error("Failed to send OTP");
    }
  } catch (error) {
    next(error);
  }
};

exports.verifyOtp = async (req, res, next) => {
  const { phone, otp } = req.body;

  try {
    // Verify the OTP using Twilio
    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: phone, code: otp });

    if (verificationCheck.status === "approved") {
      return res.status(200).json({ message: "OTP verified successfully" });
    } else {
      throw new Error("Invalid OTP");
    }
  } catch (error) {
    next(error);
  }
};
exports.getDoctorLocations =  async (req, res) => {
    try {
        // Fetch all users with role 'doctor' and their location data
        // Assuming 'role' is a field in your 'users' table, or you join with 'roles' table.
        // If 'role_id' is used, you might need to find the role_id for 'doctor' first, or join.
        // For simplicity, assuming 'role' string is directly on the user model or accessible via a relation.
        // If 'role' is a relation, you'd do: include: { role: true } and then filter by role.name
        const doctors = await prisma.users.findMany({
            where: {
                // Assuming 'role' is a direct string field or a simple relation to a 'roles' table
                // If 'role_id' is the only field, you'd need to know the ID for 'doctor' (e.g., 3)
                // For example: role_id: 3n (if BigInt) or role_id: 3 (if Int)
                role: { // Assuming 'role' is a direct string field on 'users' model
                    name: 'doctor' // Assuming role model has a 'name' field
                },
                // OR if 'role' is a direct string field on 'users' table:
                // role: 'doctor', // Use this if 'role' is a string column on the users table
                
                // Ensure latitude and longitude are not null for display on map
                latitude: { not: null },
                longitude: { not: null },
            },
            select: {
                id: true,
                user_name: true, // Or first_name, last_name
                country: true,
                latitude: true,
                longitude: true,
                // Add other public contact info if desired, e.g., phone, email (if public)
                // phone: true,
                // email: true,
            },
        });

        // Map data to ensure BigInt is stringified and coordinates are numbers
        const formattedDoctors = doctors.map(doctor => ({
            id: doctor.id.toString(),
            user_name: doctor.user_name,
            country: doctor.country,
            latitude: parseFloat(doctor.latitude), // Convert Decimal to number
            longitude: parseFloat(doctor.longitude), // Convert Decimal to number
            // phone: doctor.phone, // Include if selected above
            // email: doctor.email, // Include if selected above
        }));

        res.status(200).json(formattedDoctors);
    } catch (error) {
        console.error('Error retrieving doctor locations:', error);
        res.status(500).json({ message: 'Failed to retrieve doctor locations.', error: error.message });
    }
}