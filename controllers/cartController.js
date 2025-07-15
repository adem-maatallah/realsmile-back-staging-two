const { PrismaClient } = require("@prisma/client");
const redisClient = require("../utils/redis"); // Import Redis client
const prisma = new PrismaClient();
const REDIS_EXPIRATION_TIME = 60 * 60; // 1 hour cache expiration

// Helper function to handle BigInt and Date serialization
const bigIntToString = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(bigIntToString);
  } else if (typeof obj === "object" && obj !== null) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      // Handle BigInt
      if (typeof value === "bigint") {
        acc[key] = value.toString();
      }
      // Handle Date objects
      else if (value instanceof Date) {
        acc[key] = value.toISOString();
      }
      // Recursively handle other objects
      else {
        acc[key] = bigIntToString(value);
      }
      return acc;
    }, {});
  }
  return obj;
};

// Utility function for cache management
const getOrSetCache = async (key, fetchFunction) => {
  try {
    const cachedValue = await redisClient.get(key);
    if (cachedValue) {
      return JSON.parse(cachedValue);
    }

    const freshData = await fetchFunction();
    await redisClient.setEx(
      key,
      REDIS_EXPIRATION_TIME,
      JSON.stringify(freshData)
    );
    return freshData;
  } catch (err) {
    console.error("Redis caching error:", err);
    return fetchFunction();
  }
};

// Get cart by customer ID
exports.getCartByCustomerId = async (req, res) => {
  const { customerId } = req.params;

  // Assuming you are using session and you can access userCountry like this
  const userCountry = req?.user?.country || "EUR"; // Default to 'EUR' if no country found

  try {
    const cart = await getOrSetCache(`cart:${customerId}`, async () => {
      const fetchedCart = await prisma.cart.findUnique({
        where: { customerId: BigInt(customerId) },
        include: { cartItems: { include: { product: true } } },
      });

      if (!fetchedCart) {
        return null;
      }

      // Map the cart items to include price based on the user's country and calculate discounted price
      fetchedCart.cartItems = fetchedCart.cartItems.map((item) => {
        // Get the original price based on the user's country
        const originalPrice =
          userCountry === "TN"
            ? item.product.priceTnd
            : userCountry === "MA"
            ? item.product.priceMar
            : item.product.priceEur;

        // Calculate the discounted price if there's a discount
        const discount = item.product.discount || 0;
        const price = discount
          ? Number(originalPrice - (originalPrice * discount) / 100).toFixed(2)
          : // Use Math.round for rounding to the nearest whole number
            originalPrice;

        return {
          ...item,
          product: {
            ...item.product,
            originalPrice: originalPrice, // Return the original price
            price: price, // Return the discounted price if applicable
          },
        };
      });

      return bigIntToString(fetchedCart); // Convert BigInt fields to string
    });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    res.json(cart);
  } catch (error) {
    console.error("Failed to fetch cart:", error);
    res.status(500).json({ error: "Failed to fetch cart" });
  }
};

// Add product to cart
exports.addProductToCart = async (req, res) => {
  const { customerId, productId, quantity } = req.body;

  try {
    // Fetch the product to check stock and determine price
    const product = await prisma.product.findUnique({
      where: { id: BigInt(productId) },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if the requested quantity is available
    if (product.stock < Number(quantity)) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    // Get the original price based on the user's country
    const userCountry = req?.user?.country || "EUR";
    const originalPrice =
      userCountry === "TN"
        ? product.priceTnd
        : userCountry === "MA"
        ? product.priceMar
        : product.priceEur;

    // Calculate the discounted price if there's a discount
    const discount = product.discount || 0;
    const price = discount
      ? originalPrice - (originalPrice * discount) / 100
      : originalPrice;

    // Perform upsert operation in a single query
    const cart = await prisma.cart.upsert({
      where: { customerId: BigInt(customerId) },
      create: {
        customerId: BigInt(customerId),
        cartItems: {
          create: { productId: BigInt(productId), quantity: Number(quantity) },
        },
      },
      update: {
        cartItems: {
          upsert: {
            where: {
              cartId_productId: {
                cartId: BigInt(customerId),
                productId: BigInt(productId),
              },
            },
            create: {
              productId: BigInt(productId),
              quantity: Number(quantity),
            },
            update: { quantity: { increment: Number(quantity) } },
          },
        },
      },
      include: { cartItems: true },
    });

    // Invalidate cache after adding product
    await redisClient.del(`cart:${customerId}`);

    // Convert BigInt fields to strings using the helper function
    const cartStringified = bigIntToString(cart);
    const productStringified = bigIntToString({
      ...product,
      originalPrice,
      price,
    });

    // Return cart with price and originalPrice
    res.status(201).json({
      ...cartStringified,
      product: productStringified,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add product to cart" });
  }
};

// Modify product quantity
exports.modifyProductQuantity = async (req, res) => {
  const { customerId, productId } = req.params;
  const { quantity } = req.body;

  try {
    const cart = await prisma.cart.findUnique({
      where: { customerId: BigInt(customerId) },
    });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    // Find the cart item
    const cartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: BigInt(productId),
        },
      },
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    // Fetch the product to check stock
    const product = await prisma.product.findUnique({
      where: { id: BigInt(productId) },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if the requested quantity is available
    if (product.stock < Number(quantity)) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    // Update the quantity of the found cart item
    await prisma.cartItem.update({
      where: { id: cartItem.id },
      data: { quantity: Number(quantity) },
    });

    // Invalidate cache
    redisClient.del(`cart:${customerId}`);

    res.json({ message: "Cart item quantity updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update cart item" });
  }
};

// Clear a single cart item
exports.clearCartItem = async (req, res) => {
  const { customerId, productId } = req.params;

  try {
    // Find the cart based on the customerId
    const cart = await prisma.cart.findUnique({
      where: { customerId: BigInt(customerId) },
    });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    // Now delete the item from the cart using cartId and productId
    const deleteResult = await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id, // Use the cart ID
        productId: BigInt(productId),
      },
    });

    if (deleteResult.count === 0) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    // Invalidate cache after removing the cart item
    await redisClient.del(`cart:${customerId}`);

    res.json({ message: "Item removed from cart" });
  } catch (error) {
    console.error("Failed to remove cart item:", error);
    res.status(500).json({ error: "Failed to remove cart item" });
  }
};

// Clear all cart items for a customer
exports.clearAllCartItems = async (req, res) => {
  const { customerId } = req.params;

  try {
    // Find the cart based on customerId
    const cart = await prisma.cart.findUnique({
      where: { customerId: BigInt(customerId) },
    });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    // Delete all items in the cart using the cartId
    const deleteResult = await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    if (deleteResult.count === 0) {
      return res
        .status(404)
        .json({ message: "No items to clear from the cart" });
    }

    // Invalidate cache after clearing the cart
    await redisClient.del(`cart:${customerId}`);

    res.json({ message: "All items cleared from cart" });
  } catch (error) {
    console.error("Failed to clear cart:", error);
    res.status(500).json({ error: "Failed to clear cart" });
  }
};
