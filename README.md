# Pocketbook

A notebook-style family expense tracker designed for GitHub Pages.

## Features

- Fast comma-separated entry with category shortcuts
- Add, edit, and remove expenses and categories
- Automatic thousands separators and SGD, VND, USD, and EUR support
- Visible warnings for entries that still need SGD conversion
- Monthly total, unnecessary-spend watch bar, and yearly overview
- Separate expense books for trips, hospital stays, and other events
- One-click roll-up of a special book into the monthly list

## Publish on GitHub Pages

1. Push this project to a GitHub repository using the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions**.
4. The included workflow publishes the site after every push to `main`.

## Local development

Use Node.js 22.13 or newer, then run `npm install` and `npm run dev`.
Use `npm run build:pages` to verify the GitHub Pages version.

Expense data is saved in the browser on each device. GitHub Pages is a static
host, so entries are not automatically shared between different devices.
