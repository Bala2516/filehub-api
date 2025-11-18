const mongoose = require("mongoose");

const TopicSchema = new mongoose.Schema({
    topic: String,
    relevance_score: String
});

const TickerSchema = new mongoose.Schema({
    ticker: String,
    relevance_score: String,
    ticker_sentiment_score: String,
    ticker_sentiment_label: String
});

const BitcoinDataSchema = new mongoose.Schema({
    title: String,
    url: String,
    time_published: String,
    authors: [String],
    summary: String,
    banner_image: String,
    source: String,
    category_within_source: String,
    source_domain: String,
    topics: [TopicSchema],
    overall_sentiment_score: Number,
    overall_sentiment_label: String,
    ticker_sentiment: [TickerSchema],
    uploaded_by: String,
});

module.exports = mongoose.model("BitcoinData", BitcoinDataSchema);
