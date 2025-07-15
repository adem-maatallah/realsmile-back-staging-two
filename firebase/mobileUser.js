const {
    doc,
    getDoc,
    setDoc,
    query,
    collection,
    where,
    getDocs,
    updateDoc,
    arrayUnion
} = require('firebase/firestore');
const {
    db
} = require('./getData');


function buildDefaultDocument(data, skValue, currentTimestamp) {
    return {
        LL: currentTimestamp,
        Lck: [], // assuming empty array
        Lns: currentTimestamp,
        Ls: currentTimestamp,
        Lto: currentTimestamp,
        Lv: 0,
        abm: "",
        acm: 0,
        acr: 0,
        am: "",
        as: "allowed",
        aut: 0,
        cc: data.countryCode,
        cdid: "",
        ddt: {}, // assuming mapping means an object
        e: "",
        gc: 0,
        gm: {}, // assuming mapping means an object
        hdn: [],
        id: data.id.toString(),
        isMultiLangNotifEnabled: true,
        jo: 1713272195561,
        kmp: {}, // mapping
        logintype: 0,
        nck: data.nickname,
        notificationsMap: {}, // mapping
        nts: [],
        pbk: "",
        pd: "",
        phn: data.phoneWithCountryCode,
        phnrw: data.phone,
        plt: "android",
        pnvr: [],
        pscd: "",
        pu: data.photoUrl,
        pvk: "",
        qr: [],
        rt: [],
        sk: skValue,
        tfv: {}, // mapping
        totalvisitsANDROID: 0,
        totalvisitsIOS: 0,
        tr: 0,
        uL1: [],
        uL2: [],
        uL3: [],
        uL4: [],
        uL5: [],
        uL6: [],
        uL7: [],
        ub1: false,
        ub11: true,
        ub12: true,
        ub2: false,
        ub3: false,
        ub5: false,
        ub6: false,
        ub7: true,
        ub8: true,
        ud1: 0.001,
        ud2: 0.001,
        ud3: 0.001,
        ud4: 0.001,
        ud5: 0.001,
        ui1: 0,
        ui2: 0,
        ui3: 0,
        ui4: 0,
        ui5: 0,
        ui6: 0,
        uid: "",
        um1: {}, // mapping
        um2: {}, // mapping
        um3: {}, // mapping
        um4: {}, // mapping
        um5: {}, // mapping
        us1: "Admin",
        us2: "",
        us3: "",
        us4: "",
        us5: "",
        us6: "",
        us7: "",
        us8: "",
        us9: "",
        us10: "",
        us11: "",
        us12: "",
        us13: "",
        us14: "",
        utin: 1,
        vcm: 0,
        vcr: 0
    };
}

async function updateRegistryList(userRef, data) {
    const registryRef = doc(db, 'userapp', 'registry');

    await updateDoc(registryRef, {
        list: arrayUnion({
            n: data.nickname,
            s: data.nickname,
            d: data.photoUrl,
            p: data.phoneWithCountryCode,
            u: data.roleLowered === 'customer' ? 0 : 1,
            i: data.id.toString(),
            x: '',
            k: '',
            e: '',
            mp: {}
        }),
        xa2: "",
        xa3: "",
        xa4: "",
        xd1: "",
    });
}

function buildDefaultCustomerNotification() {
    return {
        list: []
    };
}

async function isPhoneNumberInUse(phoneNumber, roles) {
    for (const role of roles) {
        const phoneQuery = query(collection(db, role), where("phn", "==", phoneNumber));
        const phoneQuerySnapshot = await getDocs(phoneQuery);
        if (!phoneQuerySnapshot.empty) {
            return true;
        }
    }
    return false;
}

async function isUserDocumentExists(userRef) {
    const docSnapshot = await getDoc(userRef);
    if (docSnapshot.exists()) {
        return true; // Document exists
    }
    return false; // Document does not exist
}


// async function createMobileUserUtils(data) {
//     // Validate necessary data fields
//
//     // Define roles for mobile user based on input
//     const roles = {
//         'agent': 'agents',
//         'customer': 'customers'
//     };
//
//     const mobileRole = roles[data.roleLowered] || "";
//     console.log("Mobile role:", mobileRole);
//     if (!mobileRole) {
//         return {
//             success: false,
//             error: "Invalid role"
//         };
//     }
//     const roleMap = ['agents', 'customers']; // To check phone number in all roles
//
//     // Check if the phone number is already in use in any role
//     if (await isPhoneNumberInUse(data.phoneWithCountryCode, roleMap)) {
//         return {
//             success: false,
//             error: "Phone number already in use"
//         };
//     }
//
//     const skValue = mobileRole === 'agents' ? "A" : "C";
//
//     const userRef = doc(db, mobileRole, data.id.toString());
//
//     if (await isUserDocumentExists(userRef)) {
//         return {
//             success: false,
//             error: "Document already exists"
//         };
//     }
//
//     const currentTimestamp = Date.now();
//
//     const defaultDocument = buildDefaultDocument(data, skValue, currentTimestamp);
//     try {
//         await setDoc(userRef, defaultDocument);
//
//         // Create customer notifications collection with a default document
//         if (mobileRole === 'customers') {
//             const notificationsRef = doc(db, `${mobileRole}/${data.id}/customernotifications`, 'customernotifications');
//             const defaultNotification = buildDefaultCustomerNotification();
//             await setDoc(notificationsRef, defaultNotification);
//         }
//         // Update the registry list
//         await updateRegistryList(userRef, data);
//         return {
//             success: true,
//             id: data.id
//         };
//     } catch (error) {
//         console.error(`Error creating ${mobileRole}:`, error);
//         return {
//             success: false,
//             error: error.message
//         };
//     }
// }

// Utility function to get user by phone number
async function getUserByPhoneNumber(phoneNumber, roleMap) {
    for (const role of roleMap) {
        const querySnapshot = await getDocs(query(collection(db, role), where("phoneWithCountryCode", "==", phoneNumber)));
        if (!querySnapshot.empty) {
            return querySnapshot.docs[0].data();
        }
    }
    return null;
}

async function createMobileUserUtils(data) {
    // Validate necessary data fields

    // Define roles for mobile user based on input
    const roles = {
        'agent': 'agents',
        'customer': 'customers'
    };

    const mobileRole = roles[data.roleLowered] || "";
    console.log("Mobile role:", mobileRole);
    if (!mobileRole) {
        return {
            success: false,
            error: "Invalid role"
        };
    }
    const roleMap = ['agents', 'customers']; // To check phone number in all roles

    const userRef = doc(db, mobileRole, data.id.toString());

    // Check if the document already exists
    if (await isUserDocumentExists(userRef)) {
        console.log(`Document with ID ${data.id} already exists. Bypassing creation.`);
        return {
            success: true,
            id: data.id
        };
    }

    // Check if the phone number is already in use in any role
    const existingUser = await getUserByPhoneNumber(data.phoneWithCountryCode, roleMap);
    if (existingUser) {
        const existingUserId = existingUser.id.toString();
        if (existingUserId === data.id.toString()) {
            console.log(`Document with phone number ${data.phoneWithCountryCode} already exists with the same ID. Bypassing creation.`);
            return {
                success: true,
                id: data.id
            };
        } else {
            return {
                success: false,
                error: "Phone number already in use"
            };
        }
    }

    const skValue = mobileRole === 'agents' ? "A" : "C";
    const currentTimestamp = Date.now();
    const defaultDocument = buildDefaultDocument(data, skValue, currentTimestamp);

    try {
        await setDoc(userRef, defaultDocument);

        // Create customer notifications collection with a default document
        if (mobileRole === 'customers') {
            const notificationsRef = doc(db, `${mobileRole}/${data.id}/customernotifications`, 'customernotifications');
            const defaultNotification = buildDefaultCustomerNotification();
            await setDoc(notificationsRef, defaultNotification);
        }
        // Update the registry list
        await updateRegistryList(userRef, data);
        return {
            success: true,
            id: data.id
        };
    } catch (error) {
        console.error(`Error creating ${mobileRole}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}





async function updateAgentMobilePhone(data) {
    const agentRef = doc(db, "agents", data.id);

    try {
        // Retrieve the agent document
        const docSnap = await getDoc(agentRef);

        // Check if the document exists
        if (docSnap.exists()) {
            // Update the phone number
            await updateDoc(agentRef, {
                phn: data.newPhoneWithCountryCode,
                phnrw: data.newPhone
            });
            return {
                success: true,
                message: "Phone number updated successfully."
            };
        } else {
            return {
                success: false,
                message: "Agent not found."
            };
        }
    } catch (error) {
        console.error("Error updating agent's phone number:", error.message);
        return {
            success: false,
            message: error.message
        };
    }
}

module.exports = {
    createMobileUserUtils,
    updateAgentMobilePhone
};