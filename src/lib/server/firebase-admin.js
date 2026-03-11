import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { env } from '$env/dynamic/private';
import { PUBLIC_FIREBASE_DATABASE_URL } from '$env/static/public';

function getAdminApp() {
	if (getApps().length) return getApps()[0];
	const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
	return initializeApp({
		credential: cert(serviceAccount),
		databaseURL: PUBLIC_FIREBASE_DATABASE_URL
	});
}

export function getAdminDb() {
	return getDatabase(getAdminApp());
}

export function createFirebaseToken(userId) {
	return getAuth(getAdminApp()).createCustomToken(userId);
}
