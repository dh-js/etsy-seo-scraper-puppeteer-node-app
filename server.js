const path = require("path");
const express = require('express');
const hbs = require("hbs");

// Require endpoints
const etsyScraperEndpoint = require('./endpoints/etsyScraperEndpoint');

// Create a new express application
const app = express();
const { exec } = require('child_process');
const { count } = require("console");
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }))

// Render the entry point UI
app.get('/', async (req, res) => {
    res.render('etsyWebScrapeUI');
});

// Define endpoints
app.use('/etsyScraperEndpoint', etsyScraperEndpoint);

// Start the server on port 3003
const port = 3003;
app.listen(port, () => {
    console.log(`Hi! Go to the following link in your browser to start the app: http://localhost:${port}`);
    exec(`start http://localhost:${port}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`exec error: ${err}`);
            return;
        }
    });
});