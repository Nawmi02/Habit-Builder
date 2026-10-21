/**
 * Where the Django backend lives. Set EXPO_PUBLIC_API_URL in a `.env` file (see .env.example).
 *  - Android emulator  -> http://10.0.2.2:8000/api
 *  - iOS simulator     -> http://localhost:8000/api
 *  - Real phone        -> http://<your computer's LAN IP>:8000/api   (and add that IP to the
 *                         backend's ALLOWED_HOSTS, and run `manage.py runserver 0.0.0.0:8000`)
 */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000/api';
