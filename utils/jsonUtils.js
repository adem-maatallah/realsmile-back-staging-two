function sanitizeCaseDataList(casesData) {
    return casesData.map((caseData) => {
        const sanitizedData = { ...caseData };
        for (const key in sanitizedData) {
            if (typeof sanitizedData[key] === 'bigint') {
                sanitizedData[key] = Number(sanitizedData[key]);
            }
        }
        return sanitizedData;
    });
}

module.exports = {
    sanitizeCaseDataList: sanitizeCaseDataList
}