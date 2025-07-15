const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const multer = require("multer");
const redis = require("redis");
const { uploadSingleEcommerceFile } = require("../utils/googleCDN");

const storage = multer.memoryStorage();
const upload = multer({ storage });
const cpUpload = upload.fields([{ name: "file", maxCount: 1 }]);

const redisClient = require("../utils/redis"); // Import Redis client

// Utility function to handle BigInt serialization
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
};

// Utility function to generate slug from name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
};

// Utility function to get from Redis or fetch data and set cache
const getOrSetCache = async (key, fetchFunction, expiration = 3600) => {
  const cachedData = await redisClient.get(key);
  if (cachedData) return JSON.parse(cachedData);

  const freshData = await fetchFunction();
  if (freshData) {
    await redisClient.setEx(key, expiration, JSON.stringify(freshData));
  }

  return freshData;
};

// Invalidate cache function
const invalidateCache = async (key) => {
  await redisClient.del(key);
};

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await getOrSetCache("all_categories", async () => {
      const categories = await prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          thumbnail: true,
          _count: {
            select: { products: true },
          },
        },
      });

      return categories.map((category) => ({
        ...serializeBigInt(category),
        productCount: category._count.products,
        id: Number(category.id),
      }));
    });

    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
};

// Get a category by ID
exports.getCategoryById = async (req, res) => {
  const { id } = req.params;
  try {
    const category = await getOrSetCache(`category_${id}`, async () => {
      const category = await prisma.category.findUnique({
        where: { id: Number(id) },
      });
      if (category) {
        return serializeBigInt(category);
      } else {
        return null;
      }
    });

    if (category) {
      res.json(category);
    } else {
      res.status(404).json({ error: "Category not found" });
    }
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({ error: "Failed to fetch category" });
  }
};

// Create a new category
exports.createCategory = async (req, res) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      console.error("Multer error:", error);
      return res.status(500).json({ error: "File upload error" });
    }

    const { name, description } = req.body;
    const file = req.files?.file?.[0];

    try {
      const slug = generateSlug(name);

      // Upload the file to Google Cloud Storage if present
      let thumbnail = null;
      if (file) {
        thumbnail = await uploadSingleEcommerceFile(file, "categories");
      }

      const newCategory = await prisma.category.create({
        data: {
          name,
          slug,
          description,
          thumbnail: thumbnail || "",
        },
      });

      // Invalidate cache for all categories
      await invalidateCache("all_categories");

      res.status(201).json(serializeBigInt(newCategory));
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).json({ error: "Failed to create category" });
    }
  });
};

// Update a category by ID
exports.updateCategory = async (req, res) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      console.error("Multer error:", error);
      return res.status(500).json({ error: "File upload error" });
    }

    const { id } = req.params;
    const { name, description } = req.body;
    const file = req.files?.file?.[0];

    try {
      const slug = generateSlug(name);

      // Upload new file if present
      let thumbnail = null;
      if (file) {
        thumbnail = await uploadSingleEcommerceFile(file, "categories");
      }

      const updatedCategory = await prisma.category.update({
        where: { id: Number(id) },
        data: {
          name,
          slug,
          description,
          ...(thumbnail && { thumbnail }), // Only update thumbnail if new one was uploaded
        },
      });

      // Invalidate cache for both all categories and this specific category
      await invalidateCache("all_categories");
      await invalidateCache(`category_${id}`);

      res.json(serializeBigInt(updatedCategory));
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({ error: "Failed to update category" });
    }
  });
};

// Delete a category by ID
exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.category.delete({ where: { id: Number(id) } });

    // Invalidate cache for all categories and this specific category
    await invalidateCache("all_categories");
    await invalidateCache(`category_${id}`);

    res.json({ message: "Category deleted" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: "Failed to delete category" });
  }
};
