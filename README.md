# 🔍🤖 WakeelCheck (وكيل تشيك) — AI Readiness Audit Engine for E-Commerce

> **أول أداة لفحص وتأهيل المتاجر الإلكترونية لجيل الشراء الذكي وكلاء ومتصفحات الذكاء الاصطناعي (ChatGPT, Google AI Overviews, Perplexity, Safari Intelligence, Edge Copilot)**

---

## 🌟 Overview

WakeelCheck is an enterprise-grade AI agent compatibility auditor for e-commerce stores (Salla, Zid, Shopify, Custom). It performs real-time technical audits across **64 dynamic criteria** and provides verifiable technical proof (`evidence`), platform fingerprinting, Google PageSpeed Insights integration, instant `llms.txt` generation, and `AI-Ready Certified Badge` snippets.

---

## 🚀 Live Demo & Production Deployment

- **Live Site**: [https://aitchek.online](https://aitchek.online)
- **Vercel Production**: Automated continuous deployment via Vercel Serverless Functions.

---

## 🛠️ Architecture & Features

1. **Deterministic 64-Rule Audit Engine (`api/audit.js`)**: Evaluates JSON-LD Product Schemas, Merchant Return Policies, Shipping Details, OpenGraph price/currency consistency, robots.txt bot directives (`GPTBot`, `PerplexityBot`, `Google-Extended`), and semantic HTML5 structures.
2. **Technical Proof & Evidence**: Every rule outputs explicit DOM/Header signatures (e.g. `Schema @type: Product`, `Found 1 <h1> tags in DOM`, `GET /robots.txt 200 OK`).
3. **Multi-Factor Platform Detection**: Accurately detects Salla (`salla.network`), Zid (`zid.sa`), Shopify (`cdn.shopify.com`), and Custom stores.
4. **Google PageSpeed API v5**: Live mobile and desktop Lighthouse performance counters (`api/pagespeed.js`).
5. **PDF Executive Master Plan**: Included in repository as `WakeelCheck_Executive_Master_Plan.pdf`.

---

## ⚙️ Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Run local server
npm start
# App available at http://localhost:3005
```

---

## 🔒 License

MIT License © 2026 WakeelCheck Team.
