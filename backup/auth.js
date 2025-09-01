// auth.js
const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");

// Load OAuth client credentials
const credentials = JSON.parse(fs.readFileSync("oauth_credentials.json", "utf8"));

// Web client credentials
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Scopes for Google Drive
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

// Generate Auth URL
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
});

console.log("\n👉 Authorize this app by visiting:\n", authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nEnter the code from that page here: ", (code) => {
  rl.close();
  oAuth2Client.getToken(code, (err, token) => {
    if (err) return console.error("❌ Error retrieving token", err);
    fs.writeFileSync("token.json", JSON.stringify(token, null, 2));
    console.log("✅ Token stored in token.json");
  });
});
