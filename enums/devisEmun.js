const devisStatusMap = {
    draft: "draft",
    refused: "réfusé",
    accepted: "accepté",
};


const devisDbStatusMap = {
    draft: "draft",
    refused: "refused",
    accepted: "accepted",
};

const invoicesDbStatusMap = {
    paid: "paid",
    unpaid: "unpaid",
    partially_paid: "partially_paid",

}

const invoicesStatusMap = {
    paid: "payé",
    unpaid: "non payé",
    partially_paid: "partiellement payé",

}


module.exports = {
    devisStatusMap,
    devisDbStatusMap,
    invoicesDbStatusMap,
    invoicesStatusMap

};