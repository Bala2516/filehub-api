const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BitcoinData = require("../models/BitcoinData");

const router = express.Router();

const ALGO = "aes-256-cbc";
const SECRET_KEY = crypto.randomBytes(32);
const IV_LENGTH = 16;

function encryptFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, SECRET_KEY, iv);

    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(outputPath);

    output.write(iv);

    input.pipe(cipher).pipe(output);

    output.on("finish", () => resolve(true));
    output.on("error", reject);
  });
}

function getDynamicUploadPath(username) {
  const base = path.join(__dirname, "..", "uploads");

  const now = new Date();
  const dateFolder =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const finalPath = path.join(base, dateFolder, username);

  fs.mkdirSync(finalPath, { recursive: true });

  return finalPath;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const username = req.body.username || "UnknownUser";
    const uploadPath = getDynamicUploadPath(username);

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// Excel Parsing
function parseExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet);
}

// CSV Parsing
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
}

// Parse Topics
function parseTopics(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((item) => {
      const match = item.trim().match(/(.+)\((.+)\)/);
      if (!match) return null;

      return {
        topic: match[1].trim(),
        relevance_score: match[2].trim(),
      };
    })
    .filter(Boolean);
}

// Parse Ticker Sentiment
function parseTickerSentiment(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((item) => {
      const match = item.trim().match(/(.+)\((.+)\)/);
      if (!match) return null;

      return {
        ticker: match[1].trim(),
        ticker_sentiment_label: match[2].trim(),
        relevance_score: "",
        ticker_sentiment_score: "",
      };
    })
    .filter(Boolean);
}

// Upload Route
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    if (req.file.size === 0) {
      return res.status(400).json({ msg: "Uploaded file is empty" });
    }

    const filePath = req.file.path;
    const encryptedPath = filePath + ".enc";

    const ext = path.extname(req.file.originalname).toLowerCase();
    let jsonData = [];

    // Detect file type & parse
    if (ext === ".csv") {
      jsonData = await parseCSV(req.file.path);
    } else if (ext === ".xls" || ext === ".xlsx") {
      jsonData = parseExcel(req.file.path);
    } else {
      return res.status(400).json({ msg: "Only CSV or Excel files allowed" });
    }

    if (!jsonData.length || jsonData.length === 0)
      return res
        .status(400)
        .json({ msg: "File contains no data or is invalid" });

    console.log("Parsed Data:", jsonData);

    // Transform each record to include parsed fields
    jsonData = jsonData.map((row) => ({
      ...row,
      topics: parseTopics(row.topics),
      ticker_sentiment: parseTickerSentiment(row.ticker_sentiment),
    }));

    const savedData = await BitcoinData.insertMany(jsonData);

    // Encrypt file
    await encryptFile(filePath, encryptedPath);

    // Delete original unencrypted file
    fs.unlinkSync(filePath);

    res.json({
      message: "File uploaded, encrypted & data stored",
      encrypted_file: path.basename(encryptedPath),
      folder: req.file.destination,
      records_saved: savedData.length,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      msg: "Server error while processing file",
      error: error.message,
    });
  }
});

module.exports = router;
