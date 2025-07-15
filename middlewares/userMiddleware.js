const jwt = require("jsonwebtoken");
const { PrismaClient } = require('@prisma/client');
const { withAccelerate } = require('@prisma/extension-accelerate')

const prisma = new PrismaClient().$extends(withAccelerate())
const { tokenInfo } = require("../config");
const { AccessTokenError, UnauthorizedError } = require("./apiError");

async function authenticateToken(req, res, next) {
    try {
        // Extract the token from the authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            throw new AccessTokenError("No authorization header provided");
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            throw new AccessTokenError("No token provided");
        }

        // Verify the token
        const decoded = jwt.verify(token, tokenInfo.secret);
        // Fetch the user from the database
        const user = await prisma.users.findUnique({ where: { id: parseInt(decoded.userId) } });
        if (!user) {
            throw new UnauthorizedError("The user belonging to this token does no longer exist.");
        }

        // Attach the user to the request object
        req.user = user;
        next();
    } catch (error) {
        console.error("Authentication error:", error);
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ error: "Invalid token" });
        }
        res.status(401).json({ error: error.message });
    }
}

module.exports = authenticateToken;
