const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bodyParser = require("body-parser");
const BitcoinData = require("../models/BitcoinData");
const AudioFile = require("../models/AudioFile");
const VideoFile = require("../models/VideoFile");

const router = express.Router();

router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

const ALGO = "aes-256-cbc";
const SECRET_KEY = Buffer.from(process.env.AES_SECRET_KEY, "hex");
const IV_LENGTH = 16;

const MAX_MEDIA_SIZE = 10 * 1024 * 1024; // 10MB
const AUDIO_EXTS = [".mp3"];
const VIDEO_EXTS = [".mp4"];

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
    cb(null, Date.now() + path.extname(file.originalname).toLowerCase());
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

router.post("/upload", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ msg: "No files uploaded" });
    }

    const username = req.body.username || "UnknownUser";
    const results = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const filePath = file.path;

      const uniqueId = Date.now();
      const encryptedName = `${uniqueId}${ext}`;
      const encryptedPath = path.join(path.dirname(filePath), encryptedName);

      if (file.size === 0) {
        results.push({
          file: file.originalname,
          status: "error",
          message: "File is empty",
        });
        continue;
      }

      if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
        if (file.size > MAX_MEDIA_SIZE) {
          fs.unlinkSync(file.path);
          results.push({
            file: file.originalname,
            status: "error",
            message: "Audio/Video size must be less than 10MB",
          });
          continue;
        }

        await encryptFile(filePath, encryptedPath);
        fs.unlinkSync(filePath);

        let savedDoc;

        if (AUDIO_EXTS.includes(ext)) {
          savedDoc = await AudioFile.create({
            filename: encryptedName,
            original_name: file.originalname,
            filepath: encryptedPath,
            size: file.size,
            uploaded_by: username,
          });
        } else {
          savedDoc = await VideoFile.create({
            filename: encryptedName,
            original_name: file.originalname,
            filepath: encryptedPath,
            size: file.size,
            uploaded_by: username,
          });
        }

        results.push({
          file: file.originalname,
          type: AUDIO_EXTS.includes(ext) ? "audio" : "video",
          status: "success",
          model_id: savedDoc._id,
          encrypted_file: path.basename(encryptedPath),
        });

        continue;
      }

      let jsonData = [];
      let fileType = "";

      if (ext === ".csv") {
        jsonData = await parseCSV(file.path);
        fileType = "csv";
      } else if (ext === ".xls" || ext === ".xlsx") {
        jsonData = parseExcel(file.path);
        fileType = "excel";
      } else {
        results.push({
          file: file.originalname,
          status: "error",
          message: "Invalid file type",
        });
        continue;
      }

      if (!jsonData.length) {
        results.push({
          file: file.originalname,
          status: "error",
          message: "File contains no data",
        });
        continue;
      }

      jsonData = jsonData.map((row) => ({
        ...row,
        topics: parseTopics(row.topics),
        ticker_sentiment: parseTickerSentiment(row.ticker_sentiment),
        uploaded_by: username,
      }));

      const savedData = await BitcoinData.insertMany(jsonData);

      await encryptFile(filePath, encryptedPath);
      fs.unlinkSync(filePath);

      results.push({
        file: file.originalname,
        type: fileType,
        status: "success",
        encrypted_file: path.basename(encryptedPath),
        records_saved: savedData.length,
      });
    }

    res.json({
      message: "All files processed",
      total_files: req.files.length,
      results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      msg: "Server error while processing file",
      error: error.message,
    });
  }
});

router.get("/data", async (req, res) => {
  try {
    const excelCsvData = await BitcoinData.find({});
    const audioData = await AudioFile.find({});
    const videoData = await VideoFile.find({});

    const grouped = {};

    function addToGroup(user, item) {
      if (!grouped[user]) {
        grouped[user] = {
          uploaded_by: user,
          csv_excel: [],
          audio: [],
          video: [],
        };
      }
      item && grouped[user][item.type].push(item.data);
    }

    // Group CSV/Excel Data
    excelCsvData.forEach((row) => {
      addToGroup(row.uploaded_by, {
        type: "csv_excel",
        data: row,
      });
    });

    // Group Audio Data
    audioData.forEach((file) => {
      addToGroup(file.uploaded_by, {
        type: "audio",
        data: {
          _id: file._id,
          filename: file.filename,
          size: file.size,
          uploaded_at: file.uploaded_at,
        },
      });
    });

    // Group Video Data
    videoData.forEach((file) => {
      addToGroup(file.uploaded_by, {
        type: "video",
        data: {
          _id: file._id,
          filename: file.filename,
          size: file.size,
          uploaded_at: file.uploaded_at,
        },
      });
    });

    res.json({
      success: true,
      total_users: Object.keys(grouped).length,
      data: Object.values(grouped),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

router.get("/data/:uploaded_by", async (req, res) => {
  try {
    const user = req.params.uploaded_by;

    const excelCsvData = await BitcoinData.find({ uploaded_by: user });
    const audioData = await AudioFile.find({ uploaded_by: user });
    const videoData = await VideoFile.find({ uploaded_by: user });

    if (
      excelCsvData.length === 0 &&
      audioData.length === 0 &&
      videoData.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "No data found for this user",
      });
    }

    const grouped = {
      uploaded_by: user,
      csv_excel: [],
      audio: [],
      video: [],
    };

    excelCsvData.forEach((row) => {
      grouped.csv_excel.push(row);
    });

    audioData.forEach((file) => {
      grouped.audio.push({
        _id: file._id,
        filename: file.filename,
        size: file.size,
        uploaded_at: file.uploaded_at,
      });
    });

    videoData.forEach((file) => {
      grouped.video.push({
        _id: file._id,
        filename: file.filename,
        size: file.size,
        uploaded_at: file.uploaded_at,
      });
    });

    res.json({
      success: true,
      data: grouped,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      msg: "Server error",
      error: err.message,
    });
  }
});

router.get("/video/:id", async (req, res) => {
  try {
    const fileRecord = await VideoFile.findById(req.params.id);
    if (!fileRecord) {
      return res.status(404).send("Video file not found");
    }

    const encryptedPath = fileRecord.filepath;

    const encryptedStream = fs.createReadStream(encryptedPath);

    let iv;
    encryptedStream.once("readable", () => {
      iv = encryptedStream.read(16);
      const decipher = crypto.createDecipheriv("aes-256-cbc", SECRET_KEY, iv);

      res.setHeader("Content-Type", "video/mp4");
      encryptedStream.pipe(decipher).pipe(res);
    });
  } catch (err) {
    console.error("Error streaming video:", err);
    res.status(500).send("Server error");
  }
});

router.get("/audio/:id", async (req, res) => {
  try {
    const fileRecord = await AudioFile.findById(req.params.id);
    if (!fileRecord) {
      return res.status(404).send("Audio file not found");
    }

    const encryptedPath = fileRecord.filepath;
    const encryptedStream = fs.createReadStream(encryptedPath);

    let iv;
    encryptedStream.once("readable", () => {
      iv = encryptedStream.read(16);
      const decipher = crypto.createDecipheriv("aes-256-cbc", SECRET_KEY, iv);

      res.setHeader("Content-Type", "audio/mp3");
      encryptedStream.pipe(decipher).pipe(res);
    });
  } catch (err) {
    console.error("Error streaming audio:", err);
    res.status(500).send("Server error");
  }
});

router.put("/data/:id", async (req, res) => {
  try {
    const updated = await BitcoinData.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ msg: "Record not found" });
    }

    res.json({
      success: true,
      message: "Data updated successfully",
      updated,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

router.delete("/data/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const models = [
      { name: "BitcoinData", model: BitcoinData },
      { name: "AudioFile", model: AudioFile },
      { name: "VideoFile", model: VideoFile },
    ];

    for (const { name, model } of models) {
      const record = await model.findById(id);

      if (!record) continue;

      if (fs.existsSync(record.filepath)) {
        fs.unlinkSync(record.filepath);
      }

      await model.findByIdAndDelete(id);

      return res.json({
        success: true,
        message: `${name} record deleted successfully`,
      });
    }

    return res.status(404).json({ success: false, msg: "Record not found" });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
