const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());

const { BadRequestError } = require("../middlewares/apiError");
const { SuccessResponse } = require("../middlewares/apiResponse");

const bcrypt = require("bcryptjs");
const { uploadDoctorProfilePic } = require("../utils/googleCDN");
const queueEmail = require("./../utils/email");
const { createMobileUserUtils } = require("../firebase/mobileUser");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Helper function to serialize BigInt values
const serializeBigInt = (data) => {
  if (Array.isArray(data)) {
    return data.map((item) => serializeBigInt(item));
  } else if (typeof data === "object" && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        typeof value === "bigint" ? value.toString() : serializeBigInt(value),
      ])
    );
  }
  return data;
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
    const { id: commercialId } = req.user;

    const profilePictureFile = req.file;

    if (phone) phone = phone.replace(/\s/g, "");
    if (office_phone) office_phone = office_phone.replace(/\s/g, "");

    const existingUser = await prisma.users.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existingUser) {
      throw new BadRequestError(
        "A user with this email or phone already exists"
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const role = await prisma.roles.findUnique({ where: { name: "doctor" } });
    if (!role) throw new Error("Doctor role not found");

    let imageUrl = profilePictureFile
      ? await uploadDoctorProfilePic(
          profilePictureFile,
          process.env.GOOGLE_STORAGE_BUCKET_PROFILE_PICS
        )
      : "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";

    const newUser = await prisma.users.create({
      data: {
        first_name,
        last_name,
        user_name: `${first_name}_${last_name}_${Date.now()}`,
        email,
        country,
        password: hashedPassword,
        role_id: role.id,
        phone,
        profile_pic: imageUrl,
        created_at: new Date(),
        phone_verified: true,
        email_verified: true,
        commercial_id: commercialId,
        status: true, // Ensure the user is active
      },
    });

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

    // Parse the phone number for mobile account creation
    const parsedPhone = parsePhoneNumberFromString(phone);
    if (!parsedPhone) {
      throw new Error("Invalid phone number format");
    }

    const countryCode = `+${parsedPhone.countryCallingCode}`;
    const rawPhone = parsedPhone.nationalNumber;

    // Create a mobile account for the user
    const result = await createMobileUserUtils({
      id: newUser.id.toString(),
      nickname: `${first_name} ${last_name}`,
      phone: rawPhone,
      phoneWithCountryCode: phone,
      countryCode: countryCode,
      photoUrl: imageUrl,
      roleLowered: "customer",
    });

    if (result.success) {
      await prisma.users.update({
        where: {
          id: newUser.id,
        },
        data: {
          has_mobile_account: true,
        },
      });

      const templatePath = "templates/email/account-activated.html";
      await queueEmail({
        emails: [newUser.email],
        subject:
          "Votre compte a été activé et votre compte mobile créé avec succès",
        templatePath: templatePath,
      });
    } else {
      throw new Error("Failed to create mobile user account");
    }

    return new SuccessResponse("Doctor account created successfully.").send(
      res
    );
  } catch (error) {
    console.error("Failed to create doctor:", error);
    next(error);
  }
};

// Create a new commercial user
exports.createCommercial = async (req, res, next) => {
  try {
    const { first_name, last_name, email, password, phone, country } = req.body;
    const profilePictureFile = req.file;

    if (
      !first_name ||
      !last_name ||
      !email ||
      !password ||
      !phone ||
      !country
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await prisma.users.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User with this email or phone already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const role = await prisma.roles.findUnique({
      where: { name: "commercial" },
    });
    if (!role)
      return res.status(404).json({ error: "Commercial role not found" });

    let imageUrl = profilePictureFile
      ? await uploadDoctorProfilePic(
          profilePictureFile,
          process.env.GOOGLE_STORAGE_BUCKET_PROFILE_PICS
        )
      : "https://storage.googleapis.com/realsmilefiles/staticFolder/default.png";

    const newCommercial = await prisma.users.create({
      data: {
        first_name,
        last_name,
        email,
        password: hashedPassword,
        phone,
        country,
        profile_pic: imageUrl,
        role_id: role.id,
        created_at: new Date(),
        status: true,
        phone_verified: true,
        two_factor_enabled: false,
      },
    });

    return res.status(201).json({ commercial: serializeBigInt(newCommercial) });
  } catch (error) {
    console.error("Error creating commercial:", error);
    next(error);
  }
};

// Get a commercial user by ID
exports.getCommercialById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const commercial = await prisma.users.findUnique({
      where: { id: BigInt(id) },
      include: { role: true },
    });

    if (!commercial || commercial.role.name !== "commercial") {
      return res.status(404).json({ error: "Commercial not found" });
    }

    // Get the count of users assigned to this commercial
    const userCount = await prisma.users.count({
      where: { commercial_id: BigInt(id) },
    });

    return res.status(200).json({
      ...serializeBigInt(commercial),
      assigned_users: userCount,
    });
  } catch (error) {
    console.error("Error retrieving commercial:", error);
    next(error);
  }
};

// Update a commercial user
exports.updateCommercial = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, country, password } = req.body;
    const profilePictureFile = req.file;

    const updates = {};
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (email) updates.email = email;
    if (phone) updates.phone = phone;
    if (country) updates.country = country;
    if (password) updates.password = await bcrypt.hash(password, 10);

    if (profilePictureFile) {
      updates.profile_pic = await uploadDoctorProfilePic(
        profilePictureFile,
        process.env.GOOGLE_STORAGE_BUCKET_PROFILE_PICS
      );
    }

    const updatedCommercial = await prisma.users.update({
      where: { id: BigInt(id) },
      data: updates,
    });

    return res
      .status(200)
      .json({ commercial: serializeBigInt(updatedCommercial) });
  } catch (error) {
    console.error("Error updating commercial:", error);
    next(error);
  }
};

// Delete a commercial user
exports.deleteCommercial = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if the commercial exists
    const commercial = await prisma.users.findUnique({
      where: { id: BigInt(id) },
    });
    if (!commercial) {
      return res.status(404).json({ error: "Commercial not found" });
    }

    await prisma.users.delete({
      where: { id: BigInt(id) },
    });

    return res.status(204).send(); // No content response
  } catch (error) {
    console.error("Error deleting commercial:", error);
    next(error);
  }
};

// Get all commercial users
exports.getAllCommercials = async (req, res, next) => {
  try {
    const commercials = await prisma.users.findMany({
      where: { role: { name: "commercial" } },
      omit: {
        password: true,
      },
    });

    const commercialsWithDetails = await Promise.all(
      commercials.map(async (commercial) => {
        const assignedDoctors = await prisma.users.findMany({
          where: { commercial_id: commercial.id, role: { name: "doctor" } },
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        });

        return {
          ...serializeBigInt(commercial),
          assigned_doctors: assignedDoctors.map((doctor) => ({
            id: Number(doctor.id),
            first_name: doctor.first_name,
            last_name: doctor.last_name,
          })),
        };
      })
    );

    return res.status(200).json({ commercials: commercialsWithDetails });
  } catch (error) {
    console.error("Error retrieving commercials:", error);
    next(error);
  }
};

exports.assignDoctors = async (req, res, next) => {
  try {
    const { id } = req.params; // Commercial user ID
    const { doctorIds } = req.body; // List of doctor IDs to assign

    // Update doctors to assign them to the commercial user
    await prisma.users.updateMany({
      where: {
        id: { in: doctorIds.map((id) => BigInt(id)) },
        role: { name: "doctor" },
      },
      data: { commercial_id: BigInt(id) },
    });

    // Remove doctors not in the list from the commercial
    await prisma.users.updateMany({
      where: {
        commercial_id: BigInt(id),
        role: { name: "doctor" },
        id: { notIn: doctorIds.map((id) => BigInt(id)) },
      },
      data: { commercial_id: null },
    });

    return res.status(200).json({ message: "Doctors assigned successfully" });
  } catch (error) {
    console.error("Error assigning doctors:", error);
    next(error);
  }
};
