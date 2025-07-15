const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const multer = require("multer");
const { uploadSingleEcommerceFile } = require("../utils/googleCDN");
const storage = multer.memoryStorage();
const upload = multer({ storage });
const cpUpload = upload.fields([{ name: "productImages", maxCount: 10 }]);
const redisClient = require("../utils/redis"); // Import Redis client

// Utility to handle BigInt serialization
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
};

// Utility to generate slug
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "");
};

// Utility to get from Redis or set cache if data not found
const getOrSetCache = async (key, fetchFunction, expiration = 3600) => {
  const cachedData = await redisClient.get(key);
  if (cachedData) return JSON.parse(cachedData);

  const freshData = await fetchFunction();
  if (freshData) {
    await redisClient.setEx(key, expiration, JSON.stringify(freshData));
  }

  return freshData;
};

// Utility to invalidate Redis cache
const invalidateCache = async (key) => {
  await redisClient.del(key);
};

// Create a new product
exports.createProduct = async (req, res) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      console.error("Multer error:", error);
      return res.status(500).json({ error: "File upload error" });
    }

    const {
      title,
      description,
      priceTnd,
      priceMar,
      priceEur,
      currentStock,
      availableDate,
      endDate,
      isLimitDate,
      categories,
      discount,
      reference,
    } = req.body;

    const files = req.files?.productImages || [];

    try {
      let productImages = [];
      if (files.length > 0) {
        for (const file of files) {
          const imageUrl = await uploadSingleEcommerceFile(file, "products");
          productImages.push(imageUrl);
        }
      }

      const slug = generateSlug(title);
      const parsedCategories = Array.isArray(categories)
        ? categories.map((categoryId) => ({
            id: parseInt(categoryId, 10),
          }))
        : [];

      const newProduct = await prisma.product.create({
        data: {
          name: title,
          slug,
          description,
          priceTnd: parseFloat(priceTnd),
          priceMar: parseFloat(priceMar),
          priceEur: parseFloat(priceEur),
          stock: parseInt(currentStock),
          imageUrls: productImages,
          availableDate: availableDate ? new Date(availableDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          isLimitDate: Boolean(isLimitDate),
          discount: discount ? parseFloat(discount) : null,
          reference,
          categories: {
            connect: parsedCategories,
          },
        },
      });

      // Invalidate cache for all products
      await invalidateCache("all_products");

      res.status(201).json({ ...newProduct, id: newProduct.id.toString() });
    } catch (error) {
      console.error("Product creation error:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  });
};

// Get all products with categories, using Redis for caching
exports.getAllProducts = async (req, res) => {
  try {
    const products = await getOrSetCache("all_products", async () => {
      const products = await prisma.product.findMany({
        include: {
          categories: true,
        },
      });
      return products.map((product) => ({
        ...serializeBigInt(product),
        categories: product.categories.map((cat) => ({
          id: cat.id.toString(),
          name: cat.name,
        })),
      }));
    });

    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
};

// Get a product by slug, using Redis for caching
exports.getProduct = async (req, res) => {
  const { id: slug } = req.params;

  try {
    const product = await getOrSetCache(`product:${slug}`, async () => {
      const product = await prisma.product.findUnique({
        where: { slug },
        include: {
          categories: true,
        },
      });

      if (!product) return null;

      return {
        ...serializeBigInt(product),
        categories: product.categories.map((cat) => ({
          id: cat.id.toString(),
          name: cat.name,
        })),
      };
    });

    if (!product) {
      res.status(404).json({ error: "Product not found" });
    } else {
      res.json(product);
    }
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ error: "Failed to fetch product" });
  }
};

// Update an existing product by slug
exports.updateProduct = async (req, res) => {
  const { id: slug } = req.params;
  cpUpload(req, res, async (error) => {
    if (error) {
      console.error("Multer error:", error);
      return res.status(500).json({ error: "File upload error" });
    }

    const {
      title,
      description,
      priceTnd,
      priceMar,
      priceEur,
      currentStock,
      availableDate,
      endDate,
      isLimitDate,
      categories,
      discount,
      reference,
    } = req.body;

    const files = req.files?.productImages || [];

    try {
      let productImages = [];

      if (files.length > 0) {
        for (const file of files) {
          const imageUrl = await uploadSingleEcommerceFile(file, "products");
          productImages.push(imageUrl);
        }
      }

      const existingProduct = await prisma.product.findUnique({
        where: { slug },
      });

      if (!existingProduct) {
        return res.status(404).json({ error: "Product not found" });
      }

      const finalImages =
        productImages.length > 0 ? productImages : existingProduct.imageUrls;

      const updatedProduct = await prisma.product.update({
        where: { slug },
        data: {
          name: title,
          slug: generateSlug(title),
          description,
          priceTnd: parseFloat(priceTnd),
          priceMar: parseFloat(priceMar),
          priceEur: parseFloat(priceEur),
          stock: parseInt(currentStock),
          imageUrls: finalImages,
          availableDate: availableDate ? new Date(availableDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          isLimitDate: Boolean(isLimitDate),
          discount: discount ? parseFloat(discount) : 0,
          reference,
          categories: {
            set: categories.map((categoryId) => ({
              id: parseInt(categoryId),
            })),
          },
        },
      });

      // Invalidate cache for the updated product and all products
      await invalidateCache(`product:${slug}`);
      await invalidateCache("all_products");

      res.json({ ...updatedProduct, id: updatedProduct.id.toString() });
    } catch (error) {
      console.error("Product update error:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  });
};

// Delete a product by slug
exports.deleteProduct = async (req, res) => {
  const { id: slug } = req.params;
  try {
    await prisma.product.delete({ where: { slug } });

    // Invalidate cache for the deleted product and all products
    await invalidateCache(`product:${slug}`);
    await invalidateCache("all_products");

    res.json({ message: "Product deleted" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
};
