const express = require("express");
const fs = require("fs");
const path = require("path");
const fsPromises = require("fs").promises;
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const router = express.Router();
const chalk = require("chalk");

puppeteer.use(StealthPlugin());

router.post("/bestsellerSearch", async function (req, res) {
  var searchTerms = req.body.searchTerms
    .split("\n")
    .map((term) => term.trim())
    .filter(Boolean);

  //How many 'top' keywords to get
  var numberSpinner = Number(req.body.numberSpinner);

  // Read the exclude words file and split it into an array of lines
  let lines = fs.readFileSync("exclude_words.txt", "utf-8").split("\n");
  // If the first line is the specific string, remove it
  if (
    lines[0] === "**ENTER WORDS TO EXCLUDE BELOW, THIS IS NOT CASE SENSITIVE**"
  ) {
    lines = lines.slice(1);
  }
  // Split the remaining lines into an array of words
  let excludeWords = lines
    .join("\n")
    .split(/\s+/)
    .map((word) => word.trim());

  console.log("Starting Etsy Scraping.");

  // Log each search term
  searchTerms.forEach((term, index) => {
    console.log(chalk.blue(`Search term ${index + 1}: ${term}`));
  });

  browser = await puppeteer.launch({
    executablePath:
      "./chromium/puppeteer/chrome/win64-114.0.5735.133/chrome-win64/chrome.exe",
    headless: false,
    //headless: "new"
  });

  const page = await browser.newPage();
  let isFirstIteration = true;
  let successfulSearchTerms = [];
  let unsuccessfulSearchTerms = searchTerms;

  for (let searchTerm of searchTerms) {
    let encodedSearchTerm = encodeURIComponent(searchTerm); // encode for URL, can also replace spaces with '+' by using --->>> .replace(/\s+/g, '+')

    let listingDataForSearchTerm = []; // Array to hold all listing data for this search term

    //Loop twice
    for (let i = 0; i < 2; i++) {
      let searchURL;

      //if first iteration, page 1, else page 2
      if (i === 0) {
        searchURL = `https://www.etsy.com/search?q=${encodedSearchTerm}&explicit=1&is_best_seller=true&ship_to=GB`;
      } else {
        searchURL = `https://www.etsy.com/search?q=${encodedSearchTerm}&explicit=1&is_best_seller=true&ship_to=GB&page=2&ref=pagination`;
      }

      await page.goto(searchURL);

      // Random delay to mimic human behavior
      await page.waitForTimeout(Math.floor(Math.random() * 25000) + 15000);

      //If it was attempting to go to second page, check that
      //It didnt redirect to page 1 i.e. there is no second page
      // Check if the page has been redirected
      const currentPageUrl = page.url();
      if (
        i !== 0 &&
        currentPageUrl !==
          `https://www.etsy.com/search?q=${encodedSearchTerm}&explicit=1&is_best_seller=true&ship_to=GB&page=2&ref=pagination`
      ) {
        console.log(chalk.yellow(`For "${searchTerm}", page 2 does not exist`));
        break; // Break the 2x loop
      }

      //Check to see if Etsy have blocked us
      const TOO_MANY_REQUESTS_SELECTOR = "h1.wt-text-title-01";
      const tooManyRequestsElement = await page.$(TOO_MANY_REQUESTS_SELECTOR);
      if (tooManyRequestsElement) {
        const textContent = await page.evaluate(
          (element) => element.textContent,
          tooManyRequestsElement
        );
        if (
          textContent.trim() ===
          "We have received too many requests from you recently! Please try again later."
        ) {
          console.log(chalk.red("Too many requests, please try again later."));
          res.render("etsyWebScrapeUI", {
            botDetection: true,
            successfulSearchTerms,
            unsuccessfulSearchTerms,
          });
        }
      }

      if (isFirstIteration) {
        try {
          await page.waitForSelector(
            'button[data-gdpr-single-choice-accept="true"]',
            { timeout: 10000 }
          );
          await page.click('button[data-gdpr-single-choice-accept="true"]');
          await page.waitForTimeout(Math.floor(Math.random() * 10000) + 10000);
        } catch (error) {
          console.log("Cookie popup did not appear");
        }
        isFirstIteration = false;
      }

      let pageListings = await page.$$eval(
        ".js-merch-stash-check-listing.v2-listing-card",
        (elements) =>
          elements.map((item) => {
            let linkElement = item.querySelector("a.listing-link");
            let linkUrl = linkElement ? linkElement.href : "No link found";
            return linkUrl;
          })
      );

      console.log(
        `For "${searchTerm}", the number of listings on page ${i + 1} is: ${
          pageListings.length
        }`
      );

      function cleanseText(text) {
        return text.replace(/[^a-zA-Z0-9]/g, " ").replace(/\s+/g, " ");
      }

      for (let listing of pageListings) {
        await page.goto(listing);
        await page.waitForTimeout(Math.floor(Math.random() * 10000) + 10000);

        //Check to see if Etsy have blocked us
        const TOO_MANY_REQUESTS_SELECTOR = "h1.wt-text-title-01";
        const tooManyRequestsElement = await page.$(TOO_MANY_REQUESTS_SELECTOR);
        if (tooManyRequestsElement) {
          const textContent = await page.evaluate(
            (element) => element.textContent,
            tooManyRequestsElement
          );
          if (
            textContent.trim() ===
            "We have received too many requests from you recently! Please try again later."
          ) {
            console.log(
              chalk.red("Too many requests, please try again later.")
            );
            res.render("etsyWebScrapeUI", {
              botDetection: true,
              successfulSearchTerms,
              unsuccessfulSearchTerms,
            });
          }
        }

        // Create object for the current listing
        let listingObject = {};

        // Extract title
        let title = await page.evaluate(() => {
          const titleElement = document.querySelector(
            'h1[data-buy-box-listing-title="true"]'
          );
          return titleElement ? titleElement.innerText : null;
        });
        if (title) {
          title = cleanseText(title);
          listingObject.title = title;
        } else {
          listingObject.title = null;
        }

        // Extract tags
        let tags = await page.evaluate(() => {
          const tagsElement = document.querySelector(
            'div[data-appears-component-name="Listzilla_ApiSpecs_Tags_WithImages"]'
          );
          if (tagsElement) {
            const tagsData = JSON.parse(
              tagsElement.getAttribute("data-appears-event-data")
            );
            return tagsData.queries;
          }
          return null;
        });
        if (tags) {
          tags = tags.slice(0, 13).map((tag) => cleanseText(tag));
          listingObject.tags = tags;
        } else {
          listingObject.tags = null;
        }

        // Extract description
        let description = await page.evaluate(() => {
          const descriptionElement = document.querySelector(
            "p[data-product-details-description-text-content]"
          );
          return descriptionElement ? descriptionElement.innerText : null;
        });
        if (description) {
          description = cleanseText(description);
          listingObject.description = description;
        } else {
          listingObject.description = null;
        }

        // Extract alt text of images
        let altTexts = await page.evaluate((title) => {
          const imageElements = document.querySelectorAll(
            "ul[data-carousel-pagination-list] img"
          );
          return Array.from(imageElements)
            .map((img) => img.alt)
            .filter((alt) => alt !== title); // Exclude alt text that is equal to the title
        }, title);
        if (altTexts) {
          altTexts = altTexts.map((altText) => cleanseText(altText));
          listingObject.alttext = altTexts;
        } else {
          listingObject.alttext = null;
        }

        // Extract category from JSON-LD script
        const category = await page.evaluate(() => {
          const script = document.querySelector(
            'script[type="application/ld+json"]'
          );
          if (!script) return null;
          try {
            const data = JSON.parse(script.textContent);
            return data.category || null; // Return null if data.category is undefined
          } catch (error) {
            console.error(chalk.red("Error parsing JSON:", error));
            return null;
          }
        });
        listingObject.category = category;

        // Push the object to the array
        listingDataForSearchTerm.push(listingObject);
      }
    }

    console.log(`Carrying out data analysis for "${searchTerm}"`);

    let titles = listingDataForSearchTerm
      .flatMap((listing) =>
        typeof listing.title === "string" ? listing.title.split(" ") : []
      )
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let tags = listingDataForSearchTerm
      .flatMap((listing) => (Array.isArray(listing.tags) ? listing.tags : []))
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let descriptions = listingDataForSearchTerm
      .flatMap((listing) =>
        typeof listing.description === "string"
          ? listing.description.split(" ")
          : []
      )
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let altTexts = listingDataForSearchTerm
      .flatMap((listing) =>
        Array.isArray(listing.alttext)
          ? listing.alttext.flatMap((alttext) =>
              typeof alttext === "string" ? alttext.split(" ") : []
            )
          : []
      )
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let categories = listingDataForSearchTerm
      .map((listing) => listing.category)
      .filter((category) => category !== undefined); // Exclude undefined values

    // console.log("Titles:", titles);
    // console.log("Tags:", tags);
    // console.log("Descriptions:", descriptions);
    // console.log("Alt Texts:", altTexts);
    // console.log("Categories:", categories);

    function getMostCommonStrings(arr, limit) {
      let counts = arr.reduce((acc, str) => {
        // Only count the string if it's not in the excludeWords array
        if (
          !excludeWords
            .map((word) => word.toLowerCase())
            .includes(str.toLowerCase())
        ) {
          acc[str] = (acc[str] || 0) + 1;
        }
        return acc;
      }, {});

      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map((entry) => entry[0]);
    }

    let mostCommonTitles = getMostCommonStrings(titles, numberSpinner);
    let mostCommonTags = getMostCommonStrings(tags, numberSpinner);
    let mostCommonDescriptions = getMostCommonStrings(
      descriptions,
      numberSpinner
    );
    let mostCommonAltTexts = getMostCommonStrings(altTexts, numberSpinner);
    let mostCommonCategories = getMostCommonStrings(categories, numberSpinner);

    console.log(chalk.green(`Completed data analysis for "${searchTerm}"`));

    // console.log("Most Common Titles:", mostCommonTitles);
    // console.log("Most Common Tags:", mostCommonTags);
    // console.log("Most Common Descriptions:", mostCommonDescriptions);
    // console.log("Most Common Alt Texts:", mostCommonAltTexts);
    // console.log("Most Common Categories:", mostCommonCategories);

    console.log(`Creating .txt file for "${searchTerm}"`);

    // Now we have two pages worth of data for this search term, write the data to a .txt file
    let output = "";

    // Add the most common items to the output
    output += "Most Common Title Keywords:\n";
    mostCommonTitles.forEach(
      (title, index) => (output += `    ${index + 1}. ${title}\n`)
    );
    output += "\nMost Common Tags:\n";
    mostCommonTags.forEach(
      (tag, index) => (output += `    ${index + 1}. ${tag}\n`)
    );
    output += "\nMost Common Description Keywords:\n";
    mostCommonDescriptions.forEach(
      (description, index) => (output += `    ${index + 1}. ${description}\n`)
    );
    output += "\nMost Common Alt Text Keywords:\n";
    mostCommonAltTexts.forEach(
      (altText, index) => (output += `    ${index + 1}. ${altText}\n`)
    );
    output += "\nMost Common Categories:\n";
    mostCommonCategories.forEach(
      (category, index) => (output += `    ${index + 1}. ${category}\n`)
    );
    output += "\n\n";

    listingDataForSearchTerm.forEach((listing, index) => {
      output += `Listing ${index + 1}:\n`;
      output += `    Title: ${listing.title}\n\n`;
      output += `    Tags:\n`;
      listing.tags
        ? listing.tags.forEach((tag) => (output += `        - ${tag}\n`))
        : (output += `        - None\n`);
      output += `\n    Description:\n        ${listing.description}\n\n`;
      output += `    Alt Text:\n`;
      listing.alttext
        ? listing.alttext.forEach((alt) => (output += `        - ${alt}\n`))
        : (output += `        - None\n`);
      output += `\n    Category:\n        ${listing.category}\n\n\n\n`;
    });

    let filename = searchTerm;
    let counter = 1;
    while (fs.existsSync(`./created_keyword_txt_files/${filename}.txt`)) {
      filename = searchTerm + counter;
      counter++;
    }

    const filepath = `./created_keyword_txt_files/${filename}.txt`;
    await new Promise((resolve, reject) => {
      fs.writeFile(filepath, output, "utf8", function (err) {
        if (err) {
          console.log(
            chalk.red(
              `An error occurred while writing to file at path: ${filepath}. Error details: ${err}`
            )
          );
          reject(err);
        } else {
          console.log(
            chalk.green(".txt file has been created at: " + filepath)
          );
          successfulSearchTerms.push(searchTerm);
          // Remove the successful search term from the unsuccessfulSearchTerms array
          unsuccessfulSearchTerms = unsuccessfulSearchTerms.filter(
            (term) => term !== searchTerm
          );
          resolve();
        }
      });
    });
  }

  await browser.close();

  console.log("Finished Etsy Scraping.");

  res.render("etsyWebScrapeUI", {
    completedScrape: true,
    successfulSearchTerms,
    unsuccessfulSearchTerms,
  });
});

router.post("/normalSearch", async function (req, res) {
  var searchTerms = req.body.searchTerms
    .split("\n")
    .map((term) => term.trim())
    .filter(Boolean);

  //How many 'top' keywords to get
  var numberSpinner = Number(req.body.numberSpinner);

  // Read the exclude words file and split it into an array of lines
  let lines = fs.readFileSync("exclude_words.txt", "utf-8").split("\n");
  // If the first line is the specific string, remove it
  if (
    lines[0] === "**ENTER WORDS TO EXCLUDE BELOW, THIS IS NOT CASE SENSITIVE**"
  ) {
    lines = lines.slice(1);
  }
  // Split the remaining lines into an array of words
  let excludeWords = lines
    .join("\n")
    .split(/\s+/)
    .map((word) => word.trim());

  console.log("Starting Etsy Scraping.");

  // Log each search term
  searchTerms.forEach((term, index) => {
    console.log(chalk.blue(`Search term ${index + 1}: ${term}`));
  });

  browser = await puppeteer.launch({
    executablePath:
      "./chromium/puppeteer/chrome/win64-114.0.5735.133/chrome-win64/chrome.exe",
    headless: false,
    //headless: "new"
  });

  const page = await browser.newPage();
  let isFirstIteration = true;
  let successfulSearchTerms = [];
  let unsuccessfulSearchTerms = searchTerms;

  for (let searchTerm of searchTerms) {
    let encodedSearchTerm = encodeURIComponent(searchTerm); // encode for URL, can also replace spaces with '+' by using --->>> .replace(/\s+/g, '+')

    let listingDataForSearchTerm = []; // Array to hold all listing data for this search term

    //Loop twice
    for (let i = 0; i < 2; i++) {
      let searchURL;

      //if first iteration, page 1, else page 2
      if (i === 0) {
        searchURL = `https://www.etsy.com/search?q=${encodedSearchTerm}&ref=search_bar&ship_to=GB`;
      } else {
        searchURL = `https://www.etsy.com/search?q=${encodedSearchTerm}&ref=pagination&page=2&ship_to=GB`;
      }

      await page.goto(searchURL);

      // Random delay to mimic human behavior
      await page.waitForTimeout(Math.floor(Math.random() * 25000) + 15000);

      //If it was attempting to go to second page, check that
      //It didnt redirect to page 1 i.e. there is no second page
      // Check if the page has been redirected
      const currentPageUrl = page.url();
      if (
        i !== 0 &&
        currentPageUrl !==
          `https://www.etsy.com/search?q=${encodedSearchTerm}&ref=pagination&page=2&ship_to=GB`
      ) {
        console.log(chalk.yellow(`For "${searchTerm}", page 2 does not exist`));
        break; // Break the 2x loop
      }

      //Check to see if Etsy have blocked us
      const TOO_MANY_REQUESTS_SELECTOR = "h1.wt-text-title-01";
      const tooManyRequestsElement = await page.$(TOO_MANY_REQUESTS_SELECTOR);
      if (tooManyRequestsElement) {
        const textContent = await page.evaluate(
          (element) => element.textContent,
          tooManyRequestsElement
        );
        if (
          textContent.trim() ===
          "We have received too many requests from you recently! Please try again later."
        ) {
          console.log(chalk.red("Too many requests, please try again later."));
          res.render("etsyWebScrapeUI", {
            botDetection: true,
            successfulSearchTerms,
            unsuccessfulSearchTerms,
          });
        }
      }

      if (isFirstIteration) {
        try {
          await page.waitForSelector(
            'button[data-gdpr-single-choice-accept="true"]',
            { timeout: 15000 }
          );
          await page.click('button[data-gdpr-single-choice-accept="true"]');
          await page.waitForTimeout(Math.floor(Math.random() * 10000) + 10000);
        } catch (error) {
          console.log("Cookie popup did not appear");
        }
        isFirstIteration = false;
      }

      let pageListings = await page.$$eval(
        ".js-merch-stash-check-listing.v2-listing-card",
        (elements) =>
          elements.map((item) => {
            let linkElement = item.querySelector("a.listing-link");
            let linkUrl = linkElement ? linkElement.href : "No link found";
            return linkUrl;
          })
      );

      console.log(
        `For "${searchTerm}", the number of listings on page ${i + 1} is: ${
          pageListings.length
        }`
      );

      function cleanseText(text) {
        return text.replace(/[^a-zA-Z0-9]/g, " ").replace(/\s+/g, " ");
      }

      for (let listing of pageListings) {
        await page.goto(listing);
        await page.waitForTimeout(Math.floor(Math.random() * 10000) + 10000);

        //Check to see if Etsy have blocked us
        const TOO_MANY_REQUESTS_SELECTOR = "h1.wt-text-title-01";
        const tooManyRequestsElement = await page.$(TOO_MANY_REQUESTS_SELECTOR);
        if (tooManyRequestsElement) {
          const textContent = await page.evaluate(
            (element) => element.textContent,
            tooManyRequestsElement
          );
          if (
            textContent.trim() ===
            "We have received too many requests from you recently! Please try again later."
          ) {
            console.log(
              chalk.red("Too many requests, please try again later.")
            );
            res.render("etsyWebScrapeUI", {
              botDetection: true,
              successfulSearchTerms,
              unsuccessfulSearchTerms,
            });
          }
        }

        // Create object for the current listing
        let listingObject = {};

        // Extract title
        let title = await page.evaluate(() => {
          const titleElement = document.querySelector(
            'h1[data-buy-box-listing-title="true"]'
          );
          return titleElement ? titleElement.innerText : null;
        });
        if (title) {
          title = cleanseText(title);
          listingObject.title = title;
        } else {
          listingObject.title = null;
        }

        // Extract tags
        let tags = await page.evaluate(() => {
          const tagsElement = document.querySelector(
            'div[data-appears-component-name="Listzilla_ApiSpecs_Tags_WithImages"]'
          );
          if (tagsElement) {
            const tagsData = JSON.parse(
              tagsElement.getAttribute("data-appears-event-data")
            );
            return tagsData.queries;
          }
          return null;
        });
        if (tags) {
          tags = tags.slice(0, 13).map((tag) => cleanseText(tag)); // Get only the first 13 tags
          listingObject.tags = tags;
        } else {
          listingObject.tags = null;
        }

        // Extract description
        let description = await page.evaluate(() => {
          const descriptionElement = document.querySelector(
            "p[data-product-details-description-text-content]"
          );
          return descriptionElement ? descriptionElement.innerText : null;
        });
        if (description) {
          description = cleanseText(description);
          listingObject.description = description;
        } else {
          listingObject.description = null;
        }

        // Extract alt text of images
        let altTexts = await page.evaluate((title) => {
          const imageElements = document.querySelectorAll(
            "ul[data-carousel-pagination-list] img"
          );
          return Array.from(imageElements)
            .map((img) => img.alt)
            .filter((alt) => alt !== title); // Exclude alt text that is equal to the title
        }, title);
        if (altTexts) {
          altTexts = altTexts.map((altText) => cleanseText(altText));
          listingObject.alttext = altTexts;
        } else {
          listingObject.alttext = null;
        }

        // Extract category from JSON-LD script
        const category = await page.evaluate(() => {
          const script = document.querySelector(
            'script[type="application/ld+json"]'
          );
          if (!script) return null;
          try {
            const data = JSON.parse(script.textContent);
            return data.category || null; // Return null if data.category is undefined
          } catch (error) {
            console.error(chalk.red("Error parsing JSON:", error));
            return null;
          }
        });
        listingObject.category = category;

        // Push the object to the array
        listingDataForSearchTerm.push(listingObject);
      }
    }

    console.log(`Carrying out data analysis for "${searchTerm}"`);

    let titles = listingDataForSearchTerm
      .flatMap((listing) =>
        typeof listing.title === "string" ? listing.title.split(" ") : []
      )
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let tags = listingDataForSearchTerm
      .flatMap((listing) => (Array.isArray(listing.tags) ? listing.tags : []))
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let descriptions = listingDataForSearchTerm
      .flatMap((listing) =>
        typeof listing.description === "string"
          ? listing.description.split(" ")
          : []
      )
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let altTexts = listingDataForSearchTerm
      .flatMap((listing) =>
        Array.isArray(listing.alttext)
          ? listing.alttext.flatMap((alttext) =>
              typeof alttext === "string" ? alttext.split(" ") : []
            )
          : []
      )
      .filter((word) => word && isNaN(word) && word.trim() !== "");

    let categories = listingDataForSearchTerm
      .map((listing) => listing.category)
      .filter((category) => category !== undefined); // Exclude undefined values

    // console.log("Titles:", titles);
    // console.log("Tags:", tags);
    // console.log("Descriptions:", descriptions);
    // console.log("Alt Texts:", altTexts);
    // console.log("Categories:", categories);

    function getMostCommonStrings(arr, limit) {
      let counts = arr.reduce((acc, str) => {
        // Only count the string if it's not in the excludeWords array
        if (
          !excludeWords
            .map((word) => word.toLowerCase())
            .includes(str.toLowerCase())
        ) {
          acc[str] = (acc[str] || 0) + 1;
        }
        return acc;
      }, {});

      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map((entry) => entry[0]);
    }

    let mostCommonTitles = getMostCommonStrings(titles, numberSpinner);
    let mostCommonTags = getMostCommonStrings(tags, numberSpinner);
    let mostCommonDescriptions = getMostCommonStrings(
      descriptions,
      numberSpinner
    );
    let mostCommonAltTexts = getMostCommonStrings(altTexts, numberSpinner);
    let mostCommonCategories = getMostCommonStrings(categories, numberSpinner);

    console.log(chalk.green(`Completed data analysis for "${searchTerm}"`));

    // console.log("Most Common Titles:", mostCommonTitles);
    // console.log("Most Common Tags:", mostCommonTags);
    // console.log("Most Common Descriptions:", mostCommonDescriptions);
    // console.log("Most Common Alt Texts:", mostCommonAltTexts);
    // console.log("Most Common Categories:", mostCommonCategories);

    console.log(`Creating .txt file for "${searchTerm}"`);

    // Now we have two pages worth of data for this search term, write the data to a .txt file
    let output = "";

    // Add the most common items to the output
    output += "Most Common Title Keywords:\n";
    mostCommonTitles.forEach(
      (title, index) => (output += `    ${index + 1}. ${title}\n`)
    );
    output += "\nMost Common Tags:\n";
    mostCommonTags.forEach(
      (tag, index) => (output += `    ${index + 1}. ${tag}\n`)
    );
    output += "\nMost Common Description Keywords:\n";
    mostCommonDescriptions.forEach(
      (description, index) => (output += `    ${index + 1}. ${description}\n`)
    );
    output += "\nMost Common Alt Text Keywords:\n";
    mostCommonAltTexts.forEach(
      (altText, index) => (output += `    ${index + 1}. ${altText}\n`)
    );
    output += "\nMost Common Categories:\n";
    mostCommonCategories.forEach(
      (category, index) => (output += `    ${index + 1}. ${category}\n`)
    );
    output += "\n\n";

    listingDataForSearchTerm.forEach((listing, index) => {
      output += `Listing ${index + 1}:\n`;
      output += `    Title: ${listing.title}\n\n`;
      output += `    Tags:\n`;
      listing.tags
        ? listing.tags.forEach((tag) => (output += `        - ${tag}\n`))
        : (output += `        - None\n`);
      output += `\n    Description:\n        ${listing.description}\n\n`;
      output += `    Alt Text:\n`;
      listing.alttext
        ? listing.alttext.forEach((alt) => (output += `        - ${alt}\n`))
        : (output += `        - None\n`);
      output += `\n    Category:\n        ${listing.category}\n\n\n\n`;
    });

    let filename = searchTerm;
    let counter = 1;
    while (fs.existsSync(`./created_keyword_txt_files/${filename}.txt`)) {
      filename = searchTerm + counter;
      counter++;
    }

    const filepath = `./created_keyword_txt_files/${filename}.txt`;
    await new Promise((resolve, reject) => {
      fs.writeFile(filepath, output, "utf8", function (err) {
        if (err) {
          console.log(
            chalk.red(
              `An error occurred while writing to file at path: ${filepath}. Error details: ${err}`
            )
          );
          reject(err);
        } else {
          console.log(
            chalk.green(".txt file has been created at: " + filepath)
          );
          successfulSearchTerms.push(searchTerm);
          // Remove the successful search term from the unsuccessfulSearchTerms array
          unsuccessfulSearchTerms = unsuccessfulSearchTerms.filter(
            (term) => term !== searchTerm
          );
          resolve();
        }
      });
    });
  }

  await browser.close();

  console.log("Finished Etsy Scraping.");

  res.render("etsyWebScrapeUI", {
    completedScrape: true,
    successfulSearchTerms,
    unsuccessfulSearchTerms,
  });
});

module.exports = router;
