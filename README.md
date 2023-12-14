# Etsy Scraper App

This is a Node.js application that scrapes Etsy search results for a user-input search term and generates a text file with the most common keywords found in the titles, tags, descriptions, alt texts, and categories of the listings. The application uses Puppeteer for web scraping and Express for the server.

## Features

- Allows the user to enter search terms and the number of 'top' keywords that should be displayed in the returned keyword rankings.
- Scrapes Etsy search results and analyzes the data.
- Generates a text file with the most common keywords found in the listings.
- Provides a simple user interface in the browser using Handlebars.
- Handles Etsy's bot detection, uses random wait times, and informs the user if too many requests have been made.

## How it Works

The application is initiated by a POST request to the `/etsyScraperEndpoint/bestsellerSearch` or `/etsyScraperEndpoint/normalSearch` endpoint. This request is made through the browser interface, where the user can specify the search terms and the number of 'top' keywords to get.

The application scrapes Etsy search results, processes the data, and generates a text file which ranks the most commonly found keywords or terms for each of the different listing areas (title/description/tags etc.), it also displays all of the scraped data beneath. The text file is written to the `./created_keyword_txt_files/` directory.

The user interface is rendered using Handlebars. After the scraping is completed, a success message is displayed on the page.

## Running the App

The application is started by running the `server.js` file. The server listens on port 3003 and automatically opens the application in the default web browser.

The application can also be packaged into a portable executable file using PKG. This allows the client to run the app on their PC as needed.

## Dependencies

The application uses the following dependencies:

- express
- hbs
- puppeteer
- puppeteer-extra
- puppeteer-extra-plugin-stealth
- chalk

## Note

The application uses Puppeteer's stealth plugin to avoid being detected as a bot by Etsy. If too many requests are made, Etsy may temporarily block the application. In this case, the application will inform the user and stop the scraping process. Random delays are used to mimic human behavior and further avoid bot detection.