# InstaScope 🔍

InstaScope is a lightweight Instagram Profile Scraper web application built with Node.js and Express. It allows users to scrape profile metadata (e.g., follower counts, biography, category, email, external URL) using multiple strategies to avoid rate limits.

---

## 📋 Prerequisites

Before running the application, ensure you have the following installed on your machine:
* **Node.js** (v16.0.0 or higher recommended)
* **cURL** (Usually pre-installed on Windows 10/11, macOS, and most Linux distributions)

---

## 🚀 Installation & Setup

Follow these simple steps to install and run the application:

### 1. Clone the Repository
Clone the repository to your local machine:
```bash
git clone https://github.com/Riteshkumar33/insta-scrap.git
cd insta-scrap
```

### 2. Install Dependencies
Install the required Node.js dependencies:
```bash
npm install
```

### 3. Run the Server
Start the Express server:
```bash
npm start
```
By default, the server will run on: [http://localhost:3000](http://localhost:3000)

---

## 🔑 Authentication Guide (Cookies Setup)

Because Instagram profiles are heavily rate-limited and often block public scraping, you must supply active session cookies from an Instagram account.

1. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
2. Click on the **Connection Settings** panel at the top.
3. Log in to Instagram on your browser, open the developer tools (Press `F12` or right-click -> `Inspect`), and go to the **Application** (Chrome/Edge) or **Storage** (Firefox) tab.
4. Under **Cookies**, select `https://www.instagram.com`.
5. Find the `sessionid` value and copy it.
   > **Tip:** For best results, copy your entire cookie string from the browser headers or include `sessionid`, `csrftoken`, and `ds_user_id` separated by semicolons.
6. Paste the session cookie into the InstaScope settings input and click **Save**.
7. Once verified, you can search for and scrape any public Instagram username!

---

## 🛠️ Features

* **Multi-Strategy Scraping:** Dynamically attempts Web Profile API, Mobile API, GraphQL search, and HTML meta-parsing.
* **Auto-CSRF Fetching:** Automatically obtains missing CSRF tokens when only a `sessionid` is supplied.
* **CSV Export:** Export scraped profile details instantly to a CSV file.
* **Image Proxy:** Seamlessly displays high-definition Instagram profile pictures without CORS issues.
