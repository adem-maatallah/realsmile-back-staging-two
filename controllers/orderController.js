const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto"); // For generating order reference

// Generate a unique order reference (e.g., REF-XXXXXX)
function generateOrderReference() {
  return `REF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Helper function to convert BigInt to String recursively in an object
function convertBigIntToString(obj) {
  if (typeof obj !== "object" || obj === null) return obj;

  for (const key in obj) {
    if (typeof obj[key] === "bigint") {
      obj[key] = obj[key].toString(); // Convert BigInt to string
    } else if (typeof obj[key] === "object") {
      convertBigIntToString(obj[key]); // Recursively handle nested objects
    }
  }
  return obj;
}

exports.createOrder = async (req, res) => {
  const {
    customerId,
    items, // Contains product information including images
    status = "draft",
    currency,
    orderNote,
    customerName,
    phoneNumber,
    country,
    state,
    city,
    zip,
    streetAddress,
    address2,
  } = req.body;

  try {
    const totalAmount = items
      ? items.reduce((acc, item) => acc + item.quantity * item.price, 0)
      : 0;

    const newOrder = await prisma.order.create({
      data: {
        reference: generateOrderReference(),
        customerId: Number(customerId),
        totalAmount,
        status,
        currency,
        orderNote,
        customerName,
        phoneNumber,
        country,
        state,
        city,
        zip,
        streetAddress,
        address2,
        orderItems: {
          create: items.map((item) => ({
            productId: Number(item.productId),
            quantity: Number(item.quantity),
            price: item.price,
            currency: item.currency,
          })),
        },
      },
    });

    res.status(201).json({
      order: convertBigIntToString(newOrder),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create order" });
  }
};

// Get orders by customer ID
exports.getOrders = async (req, res) => {
  const { role } = req.user; // Assuming `req.user` contains the authenticated user's details

  try {
    let orders;

    if (role === "admin") {
      // If the user is an admin, fetch all orders
      orders = await prisma.order.findMany({
        include: {
          orderItems: { include: { product: true } },
          invoice: true, // Include related invoice data
        },
      });
    } else {
      // If the user is not an admin, fetch only their own orders
      orders = await prisma.order.findMany({
        where: { customerId: Number(req.user.id) },
        include: {
          orderItems: { include: { product: true } },
          invoice: true, // Include related invoice data
        },
      });
    }

    res.json(convertBigIntToString(orders));
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
};

exports.getOrderByReference = async (req, res) => {
  const { reference } = req.params;
  try {
    const order = await prisma.order.findUnique({
      where: { reference },
      include: {
        orderItems: {
          include: {
            product: true, // Include the related product information
          },
        },
      },
    });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(convertBigIntToString(order)); // If you're using a function to handle BigInt serialization
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch order" });
  }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
  const { reference } = req.params;
  const {
    status,
    customerName,
    phoneNumber,
    country,
    state,
    city,
    zip,
    street,
    address2,
    orderNote,
  } = req.body;

  try {
    const updatedOrder = await prisma.order.update({
      where: { reference: reference },
      data: {
        status,
        customerName,
        phoneNumber,
        country,
        state,
        city,
        zip,
        streetAddress: street,
        address2,
        orderNote,
      },
    });

    res.json(convertBigIntToString(updatedOrder));
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Failed to update order status" });
  }
};

// Delete an order by ID
exports.deleteOrder = async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.order.delete({ where: { id: Number(id) } });
    res.json({ message: "Order deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete order" });
  }
};

exports.setToShipping = async (req, res) => {
  const { reference } = req.params;
  const { trackingUrl } = req.body; // The shipping tracking URL provided by the admin

  try {
    const updatedOrder = await prisma.order.update({
      where: { reference },
      data: {
        status: "shipping",
        trackingUrl, // You can add a `trackingUrl` field in your schema to store this
      },
    });

    res.status(200).json({
      message: "Order status updated to shipping",
      order: convertBigIntToString(updatedOrder),
    });
  } catch (error) {
    console.error("Error updating order to shipping:", error);
    res.status(500).json({ error: "Failed to update order to shipping" });
  }
};

exports.confirmShipment = async (req, res) => {
  const { reference } = req.params;

  try {
    const updatedOrder = await prisma.order.update({
      where: { reference },
      data: {
        status: "completed", // Set the order status to completed upon confirmation
      },
    });

    res.status(200).json({
      message: "Shipment confirmed",
      order: convertBigIntToString(updatedOrder),
    });
  } catch (error) {
    console.error("Error confirming shipment:", error);
    res.status(500).json({ error: "Failed to confirm shipment" });
  }
};

// Approve an order
exports.approveOrder = async (req, res) => {
  const { reference } = req.params;

  try {
    const updatedOrder = await prisma.order.update({
      where: { reference },
      data: {
        status: "approved",
      },
    });

    res.status(200).json({
      message: "Order approved successfully",
      order: convertBigIntToString(updatedOrder),
    });
  } catch (error) {
    console.error("Error approving order:", error);
    res.status(500).json({ error: "Failed to approve order" });
  }
};
