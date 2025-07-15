
const doctorLinkStatusMap = Object.freeze({
    accepted: 'accepted',
    rejected: 'rejected',
    not_treated: 'not treated',
});


const adminLinkStatusMap = Object.freeze({
    accepted: 'accepted',
    rejected: 'rejected',
    not_treated: 'not treated',
});

const generalLinkStatusMap = Object.freeze({
    accepted: 'accepted',
    not_treated: 'not_treated',
    rejected: 'rejected',
});
const dbLinkStatusMap = Object.freeze({
    accepted: 'accepted',
    not_treated: 'not_treated',
    rejected: 'rejected',
});


doctorLinkStatusMapTranslatedToFrench = Object.freeze( {
    accepted: 'accepté',
    rejected: 'rejeté',
    not_treated: 'non traité',
});

module.exports = {
    doctorLinkStatusMap,
    adminLinkStatusMap,
    generalLinkStatusMap,
    doctorLinkStatusMapTranslatedToFrench,
    dbLinkStatusMap,
}