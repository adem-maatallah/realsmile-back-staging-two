const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());
const { SuccessResponse } = require("../middlewares/apiResponse");

exports.fetchAll = async (req, res, next) => {
  const user = req.user;

  try {
    // Determine the price field to select based on the user's country
    let priceField;
    switch (user.country) {
      case "TN":
        priceField = { tnd_price: true };
        break;
      case "MA":
        priceField = { drh_price: true };
        break;
      default:
        priceField = { eur_price: true };
    }

    const packs = await prisma.packs.findMany({
      select: {
        id: true,
        name: true,
        nbr_months_duration: true,
        ...priceField, // Spread the selected price field into the query
      },
    });

    // Transform the pack data
    const modifiedPacks = packs.map((pack) => ({
      id: pack.id.toString(),
      name: pack.name,
      price: pack.tnd_price || pack.eur_price || pack.drh_price,
      nbr_months_duration: pack.nbr_months_duration,
    }));

    return new SuccessResponse(modifiedPacks).send(res);
  } catch (error) {
    console.error("Failed to fetch data:", error);
    next(error); // Pass the error to the next middleware
  }
};

exports.fetchAllPacks = async (req, res, next) => {
  const { caseId } = req.query;

  try {
    // Fetch the doctor's user information based on the caseId
    const caseData = await prisma.cases.findUnique({
      where: { id: caseId },
      select: {
        doctor: {
          select: {
            user: {
              select: {
                country: true,
              },
            },
          },
        },
      },
    });

    if (!caseData || !caseData.doctor || !caseData.doctor.user) {
      throw new Error(
        "Doctor or user information not found for the given case ID"
      );
    }

    const userCountry = caseData.doctor.user.country;

    // Determine the price field to select based on the user's country
    let priceField;
    switch (userCountry) {
      case "TN":
        priceField = { tnd_price: true };
        break;
      case "MA":
        priceField = { drh_price: true };
        break;
      default:
        priceField = { eur_price: true };
    }

    const packs = await prisma.packs.findMany({
      select: {
        id: true,
        name: true,
        nbr_months_duration: true,
        ...priceField, // Spread the selected price field into the query
      },
    });

    // Transform the pack data
    const modifiedPacks = packs.map((pack) => ({
      id: pack.id.toString(),
      name: pack.name,
      price: pack.tnd_price || pack.eur_price || pack.drh_price,
      nbr_months_duration: pack.nbr_months_duration,
    }));

    return new SuccessResponse(modifiedPacks).send(res);
  } catch (error) {
    console.error("Failed to fetch data:", error);
    next(error); // Pass the error to the next middleware
  }
};
