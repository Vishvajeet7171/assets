const fs = require("fs");
const archiver = require("archiver");
const fetch = require("node-fetch");
const { google } = require("googleapis");
require("dotenv").config();

// ====== 🔑 Google Drive Setup (ENV based, no local files) ======
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const FOLDER_ID = process.env.FOLDER_ID;

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "https://developers.google.com/oauthplayground" // redirect URI
);

oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const drive = google.drive({ version: "v3", auth: oAuth2Client });

// ====== 📦 Supabase Setup ======
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLES = [
  "activity_logs",
  "asset_issues",
  "asset_transfers",
  "assets",
  "labs",
  "notifications",
  "user_profiles",
];

// ====== 📂 Local Backup Paths ======
const BACKUP_DIR = "./backups";
const TMP_DIR = "./temp_csvs";
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ====== 📥 Fetch Table Data ======
async function fetchTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.statusText}`);

  return await res.json();
}

// ====== 📝 Save as CSV ======
function saveCSV(table, data) {
  if (data.length === 0) return null;

  const headers = Object.keys(data[0]).join(",");
  const rows = data.map((row) =>
    Object.values(row)
      .map((val) => `"${String(val).replace(/"/g, '""')}"`)
      .join(",")
  );

  const csv = [headers, ...rows].join("\n");
  const filePath = `${TMP_DIR}/${table}.csv`;
  fs.writeFileSync(filePath, csv);
  console.log(`📂 Saved ${table}.csv`);
  return filePath;
}

// ====== 📦 Zip All Backups ======
function createZip() {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-"); 
    const zipName = `backup-${timestamp}.zip`;
    const zipPath = `${BACKUP_DIR}/${zipName}`;

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(zipPath));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(TMP_DIR, false);
    archive.finalize();
  });
}

// ====== ☁️ Upload to Google Drive ======
async function uploadToDrive(filePath, fileName) {
  const fileMetadata = {
    name: fileName,
    parents: [FOLDER_ID],
  };

  const media = {
    mimeType: "application/zip",
    body: fs.createReadStream(filePath),
  };

  const res = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: "id, parents",
  });

  console.log(`✅ Uploaded ${fileName} → Google Drive (ID: ${res.data.id})`);
}

// ====== 🧹 Cleanup Local Temp CSV ======
function cleanupTemp() {
  fs.readdirSync(TMP_DIR).forEach((file) => {
    fs.unlinkSync(`${TMP_DIR}/${file}`);
  });
  console.log("🧹 Cleaned up temp CSV files");
}

// ====== 🧹 Keep only latest 3 backups (Local) ======
function cleanupLocalBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".zip"))
    .map(f => ({ name: f, time: fs.statSync(`${BACKUP_DIR}/${f}`).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);

  if (files.length > 3) {
    const toDelete = files.slice(3);
    toDelete.forEach(f => {
      fs.unlinkSync(`${BACKUP_DIR}/${f.name}`);
      console.log(`🗑️ Deleted old local backup: ${f.name}`);
    });
  }
}

// ====== 🧹 Keep only latest 3 backups (Google Drive) ======
async function cleanupDriveBackups() {
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and mimeType='application/zip'`,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime desc",
  });

  const files = res.data.files || [];
  if (files.length > 3) {
    const toDelete = files.slice(3);
    for (const file of toDelete) {
      await drive.files.delete({ fileId: file.id });
      console.log(`🗑️ Deleted old Drive backup: ${file.name}`);
    }
  }
}

// ====== 🚀 Run Backup ======
async function runBackup() {
  try {
    for (const table of TABLES) {
      console.log(`📥 Fetching data from ${table}...`);
      const data = await fetchTable(table);
      saveCSV(table, data);
    }

    console.log("📦 Creating zip archive...");
    const zipPath = await createZip();
    const zipName = zipPath.split("/").pop();

    console.log("☁️ Uploading to Google Drive...");
    await uploadToDrive(zipPath, zipName);

    // cleanup temp files
    cleanupTemp();

    // cleanup old backups
    cleanupLocalBackups();
    await cleanupDriveBackups();

    console.log("🎉 Backup complete!");
  } catch (err) {
    console.error("❌ Backup failed:", err);
  }
}

runBackup();
