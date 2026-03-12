import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { env } from '$env/dynamic/private';

function getAdminApp() {
	if (getApps().length) return getApps()[0];
	const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
	return initializeApp({
		credential: cert(serviceAccount),
		databaseURL: env.FIREBASE_DATABASE_URL
	});
}

export function getAdminDb() {
	return getDatabase(getAdminApp());
}

export function createFirebaseToken(userId) {
	return getAuth(getAdminApp()).createCustomToken(userId);
}
