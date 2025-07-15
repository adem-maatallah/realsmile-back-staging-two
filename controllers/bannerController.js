const {
    PrismaClient
} = require('@prisma/client');
const {
    withAccelerate
} = require('@prisma/extension-accelerate');
const prisma = new PrismaClient().$extends(withAccelerate())

exports.fetchAll = async (req, res) => {
    const {
        isActive
    } = req.query;

    let whereClause = {};
    if (isActive === 'true') {
        whereClause.status = 'active';
    } else if (isActive === 'false') {
        whereClause.status = 'inactive';
    }
    // If isActive is not specified, whereClause remains empty

    try {
        const banners = await prisma.banners.findMany({
            where: whereClause,
        });
        res.json(banners);
    } catch (error) {
        console.error('Error fetching banners:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    } finally {
        await prisma.$disconnect();
    }
};