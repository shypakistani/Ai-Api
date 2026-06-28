# AI API Server

A lightweight, serverless-ready Python API designed to power AI chat applications. This repository contains a flexible backend architecture configured for seamless deployment on Vercel or local environments.

---

## Features

* **Serverless Architecture**: Built with configurations optimized for instant deployment.
* **Minimal Footprint**: Uses a clean, isolated setup with minimal external dependencies.
* **Modularity**: Dedicated routing and application logic housed inside clean components.

---

## Repository Structure

```text
├── chat.py           # Core backend router and chat execution logic
├── requirements.txt   # Third-party Python package dependencies
└── vercel.json       # Deployment configuration for Vercel Serverless Functions
```

---

## Tech Stack

* **Language**: Python (100%)
* **Platform/Hosting**: Vercel (Serverless)

---

## Getting Started

Follow these steps to set up and run the API server locally:

### 1. Prerequisites
Ensure you have Python 3.9+ installed on your system.

### 2. Clone the Repository
```bash
git clone https://github.com
cd Ai-Api
```

### 3. Create a Virtual Environment
```bash
# Create the environment
python -m venv venv

# Activate on Windows:
venv\Scripts\activate

# Activate on macOS/Linux:
source venv/bin/activate
```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

### 5. Launch the Server
```bash
python chat.py
```

---

## Deployment

This project is pre-configured to deploy directly as a serverless application using the `vercel.json` runtime configurations. 

To deploy instantly via the Vercel CLI:
```bash
# Install Vercel CLI globally (if not already installed)
npm install -g vercel

# Deploy to the cloud
vercel
```

---

## License

This project is available for open-source use. Please check back later for specific license details.
