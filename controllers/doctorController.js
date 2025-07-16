const { PrismaClient, Prisma } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");
const asyncHandler = require("express-async-handler");

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
// Helper function to convert BigInt to Number safely for JSON responses
const safeBigIntToNumber = (value) => {
  if (typeof value === 'bigint') {
    // Check if the BigInt is within safe integer range before converting
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      console.warn(`BigInt value ${value} exceeds Number.MAX_SAFE_INTEGER or MIN_SAFE_INTEGER. Potential precision loss.`);
      // You might want to stringify it if precise BigInt representation is critical on frontend
      return value.toString();
    }
    return Number(value);
  }
  return value;
};
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
// Your existing getDoctorLocations, already wrapped in asyncHandler, which is good.
// Your existing getDoctorLocations, already wrapped in asyncHandler, which is good.
exports.getDoctorLocations = asyncHandler(async (req, res) => {
    try {
        const doctorsData = await prisma.doctors.findMany({
            where: {
                user: {
                    role: {
                        name: 'doctor'
                    },
                    latitude: { not: null },
                    longitude: { not: null },
                },
            },
            select: {
                id: true,
                speciality: true,
                address: true,
                city: true,
                office_phone: true,
                user: {
                    select: {
                        id: true,
                        user_name: true,
                        first_name: true,
                        last_name: true,
                        country: true,
                        latitude: true,
                        longitude: true,
                        email: true,
                        phone: true,
                        // Add profile_pic here
                        country: true, // <-- This is where the country comes from the users table

                        profile_pic: true, // <--- ADD THIS LINE
                    },
                },
            },
        });

        const formattedDoctors = doctorsData.map(doctor => ({
            id: safeBigIntToNumber(doctor.user.id), // Use safeBigIntToNumber here
            user_name: doctor.user.user_name || `${doctor.user.first_name || ''} ${doctor.user.last_name || ''}`.trim(),
            first_name: doctor.user.first_name,
            last_name: doctor.user.last_name,
            country: doctor.user.country,
            latitude: doctor.user.latitude !== null ? parseFloat(doctor.user.latitude.toString()) : null,
            longitude: doctor.user.longitude !== null ? parseFloat(doctor.user.longitude.toString()) : null,
            phone: doctor.office_phone || doctor.user.phone,
            email: doctor.user.email,
            speciality: doctor.speciality,
            address: doctor.address,
            city: doctor.city,
            // Add profile_pic to the formatted output
            profile_pic: doctor.user.profile_pic, // <--- ADD THIS LINE
        }));

        res.status(200).json(formattedDoctors);
    } catch (error) {
        console.error('Error retrieving doctor locations:', error);
        res.status(500).json({ message: 'Failed to retrieve doctor locations.', error: error.message });
    }
});
// New function to get a single doctor's full details
exports.getDoctorDetails = asyncHandler(async (req, res) => {
  const { id } = req.params; // Get the doctor ID from the URL parameters

  try {
    const doctor = await prisma.doctors.findUnique({
      where: {
        user_id: BigInt(id), // Assuming doctorId corresponds to user_id (BigInt)
      },
      include: {
        user: {
          select: {
            id: true,
            user_name: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            profile_pic: true,
            country: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found.' });
    }

    // Format the doctor data similar to how you do it for getDoctorLocations
    const formattedDoctor = {
      id: safeBigIntToNumber(doctor.user.id).toString(), // Ensure ID is string for consistency with frontend
      user_name: doctor.user.user_name || `${doctor.user.first_name || ''} ${doctor.user.last_name || ''}`.trim(),
      first_name: doctor.user.first_name,
      last_name: doctor.user.last_name,
      email: doctor.user.email,
      phone: doctor.user.phone,
      profile_pic: doctor.user.profile_pic,
      country: doctor.user.country,
      latitude: doctor.user.latitude !== null ? parseFloat(doctor.user.latitude.toString()) : null,
      longitude: doctor.user.longitude !== null ? parseFloat(doctor.user.longitude.toString()) : null,
      speciality: doctor.speciality,
      address: doctor.address,
      address_2: doctor.address_2, // Include address_2
      city: doctor.city,
      zip: doctor.zip, // Include zip
      office_phone: doctor.office_phone, // Include office_phone
    };

    res.status(200).json(formattedDoctor);
  } catch (error) {
    console.error('Error retrieving doctor details:', error);
    res.status(500).json({ message: 'Failed to retrieve doctor details.', error: error.message });
  }
});
exports.getDoctorById = asyncHandler(async (req, res) => {
  try {
    const doctorId = req.params.id;

    const doctorData = await prisma.doctors.findFirst({
      where: {
        user_id: BigInt(doctorId), // Assuming the ID passed is the user_id
        user: {
          role: {
            name: 'doctor'
          },
        },
      },
      select: {
        id: true,
        speciality: true,
        address: true,
        address_2: true,
        city: true,
        zip: true,
        office_phone: true,
        user: {
          select: {
            id: true,
            user_name: true,
            first_name: true,
            last_name: true,
            country: true,
            latitude: true,
            longitude: true,
            email: true,
            phone: true,
            profile_pic: true,
          },
        },
      },
    });

    if (!doctorData) {
      return res.status(404).json({ message: 'Doctor not found.' });
    }

    const formattedDoctor = {
      id: safeBigIntToNumber(doctorData.user.id),
      user_name: doctorData.user.user_name || `${doctorData.user.first_name || ''} ${doctorData.user.last_name || ''}`.trim(),
      first_name: doctorData.user.first_name,
      last_name: doctorData.user.last_name,
      country: doctorData.user.country,
      latitude: doctorData.user.latitude !== null ? parseFloat(doctorData.user.latitude.toString()) : null,
      longitude: doctorData.user.longitude !== null ? parseFloat(doctorData.user.longitude.toString()) : null,
      phone: doctorData.office_phone || doctorData.user.phone,
      email: doctorData.user.email,
      speciality: doctorData.speciality,
      address: doctorData.address,
      address_2: doctorData.address_2,
      city: doctorData.city,
      zip: doctorData.zip,
      profile_pic: doctorData.user.profile_pic,
    };

    res.status(200).json(formattedDoctor);
  } catch (error) {
    console.error('Error retrieving doctor details:', error);
    res.status(500).json({ message: 'Failed to retrieve doctor details.', error: error.message });
  }
});