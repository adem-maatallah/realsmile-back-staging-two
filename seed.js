const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt"); // Import bcrypt
const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Commercial Accounts...");

  // Create Commercial Role (if it doesn't exist)
  const commercialRole = await prisma.roles.upsert({
    where: { name: "Commercial" },
    update: {},
    create: {
      id: 8, // Use an appropriate ID or remove it to auto-generate
      name: "Commercial",
      description:
        "Role for commercials responsible for client engagement and cases",
    },
  });

  // Function to hash passwords
  const hashPassword = async (password) => {
    const saltRounds = 10; // Recommended rounds for bcrypt
    return await bcrypt.hash(password, saltRounds);
  };

  // Commercial User Data
  const commercials = [
    {
      email: "commercial1@example.com",
      password: "password123", // Plain password to hash
      first_name: "Commercial",
      last_name: "One",
      role_id: commercialRole.id,
      status: true,
      phone: "+2161234567890",
      phone_verified: true,
      country: "TN",
    },
    {
      email: "commercial2@example.com",
      password: "password456", // Plain password to hash
      first_name: "Commercial",
      last_name: "Two",
      role_id: commercialRole.id,
      status: true,
      phone: "+2120987654321",
      phone_verified: true,
      country: "MA",
    },
    {
      email: "commercial3@example.com",
      password: "password789", // Plain password to hash
      first_name: "Commercial",
      last_name: "Three",
      role_id: commercialRole.id,
      status: true,
      phone: "+2160987654325",
      phone_verified: true,
      country: "FR",
    },
  ];

  for (const commercial of commercials) {
    const hashedPassword = await hashPassword(commercial.password); // Hash password
    await prisma.users.upsert({
      where: { email: commercial.email },
      update: {},
      create: {
        ...commercial,
        password: hashedPassword, // Use hashed password
      },
    });
  }

  console.log("Commercial Accounts Seeded Successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
