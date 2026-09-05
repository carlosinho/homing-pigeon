# Google OAuth setup

This describes how to set up Google Cloud connection.

## 1. Create and select a project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project name in the top bar.
3. Select an existing project, or click **New project**, enter a name, and click **Create**.
4. Make sure that project remains selected. Complete the following steps in the same Google Cloud project.

## 2. Enable the Gmail API

1. Open the navigation menu.
2. Go to **APIs & Services → Library**.
3. Search for **Gmail API** and open it.
4. Click **Enable**. If the button says **Manage**, it is already enabled.

## 3. Configure the OAuth app if needed

1. Go to **Google Auth Platform → Overview**.
2. If you already see pages such as **Branding**, **Audience**, **Data Access**, and **Clients**, OAuth is already configured. Skip the rest of this section and continue with step 4 below.
3. If you see **Get started**, click it and complete the setup:
   - **App Information:** enter an app name, select your email under **User support email**, and click **Next**.
   - **Audience:** choose **External** for a personal Gmail account, then click **Next**.
   - **Contact Information:** enter your email and click **Next**.
   - **Finish:** accept the policy, click **Continue**, then click **Create**.

## 4. Add your Gmail account as a test user

1. Go to **Google Auth Platform → Audience**.
2. Check **Publishing status**.
3. If it says **Testing**, find **Test users**, click **Add users**, enter the Gmail address you will connect, and click **Save**.
4. If it says **In production**, or the user type is **Internal**, skip this step.

## 5. Add the Gmail permission

1. Go to **Google Auth Platform → Data Access**.
2. Click **Add or remove scopes**.
3. Search for `gmail.readonly`. If it does not appear, enter this under **Manually add scopes**:

```text
https://www.googleapis.com/auth/gmail.readonly
```

4. Select the scope. If entered manually, click **Add to table**.
5. Click **Update**, then **Save** if shown.

## 6. Create the OAuth client

1. Go to **Google Auth Platform → Clients**.
2. Click **Create client**.
3. Set **Application type** to **Web application**.
4. Enter any name, such as `Homing Pigeon local`.
5. Leave **Authorized JavaScript origins** empty.
6. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:

```text
http://localhost:3001/api/auth/google/callback
```

7. Click **Create**.
8. Copy the **Client ID** and **Client secret**.

## 7. Configure Homing Pigeon

Create `.env`:

```bash
cp .env.example .env
```

Open `.env` and set:

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Keep the existing `GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback` value.

## 8. Connect Gmail

1. Run `npm run dev`.
2. Open `http://localhost:5173`.
3. Open the Fetch screen and click **Connect Gmail**.
4. Choose the Gmail account you added as a test user and approve read-only Gmail access.

If Google reports `redirect_uri_mismatch`, make sure the redirect URI in Google Cloud is exactly `http://localhost:3001/api/auth/google/callback`.
