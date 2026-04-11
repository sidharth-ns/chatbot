# OnboardBot

AI-powered onboarding chatbot that helps new team members understand a project by chatting with its Markdown documentation.

Built with **Streamlit** for the UI and **PageIndex** for vectorless, reasoning-based RAG — no embeddings, no vector database.

## Features

- **Document Ingestion** — Upload Markdown files or scan a folder. PageIndex builds hierarchical tree structures from heading levels.
- **Onboarding Checklist** — Interactive conversational checklist guides new members through environment setup (repo clone, git, SSH, dependencies, env vars, running locally).
- **Chat with Docs** — Ask questions and get answers grounded in your documentation with source citations.
- **Smart Retrieval** — Claude reasons over document tree structures to find relevant sections, then generates answers with references.
- **Suggested Questions** — AI-generated starter and follow-up questions based on indexed content.
- **Caching** — Tree JSONs cached to disk by file content hash to avoid redundant LLM calls.

## Architecture

```
OnboardBot
├── Streamlit (UI + state management)
├── PageIndex (markdown → hierarchical tree)
├── Claude (tree search reasoning + chat responses)
└── File-based cache (no database needed)
```

**LLM Configuration:**
- **PageIndex** uses `litellm` internally, supporting 100+ LLM providers. Default: `anthropic/claude-sonnet-4-20250514`
- **Chat** uses the Anthropic SDK directly. Default: `claude-sonnet-4-20250514`
- Both are configurable via `.env`

## Quick Start

### Prerequisites

- Python 3.11+
- An Anthropic API key with credits ([console.anthropic.com](https://console.anthropic.com))

### Setup

```bash
# Clone the repo
git clone <repo-url>
cd chatbot

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Clone PageIndex (vectorless RAG library)
git clone https://github.com/VectifyAI/PageIndex.git lib/PageIndex

# Configure API key
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY

# Run the app
streamlit run app.py
```

The app will be available at `http://localhost:8501`.

### Docker

```bash
# Build and run with Docker Compose
docker-compose up --build

# Or build manually
docker build -t onboardbot .
docker run -p 8501:8501 --env-file .env onboardbot
```

## Usage

1. **Upload Docs** — Go to the Upload page and either load sample docs or upload your own `.md` files
2. **Onboarding** — The Chat page starts with an interactive checklist. Answer Yes/No to each setup question.
3. **Chat** — After the checklist, ask any question about your project documentation

## Configuration

### Environment Variables (`.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `OPENAI_API_KEY` | No | — | OpenAI key (if using OpenAI for PageIndex) |
| `PAGEINDEX_MODEL` | No | `anthropic/claude-sonnet-4-20250514` | LLM for PageIndex tree generation (litellm format) |
| `CHAT_MODEL` | No | `claude-sonnet-4-20250514` | LLM for chat responses (Anthropic SDK format) |

### Checklist Customization

Edit `config/checklist_config.json` to add, remove, or customize onboarding questions. Each question can have:
- Static commands to display on "No"
- Links to external resources
- `search_terms` for automatic doc search when no static content is provided

## Project Structure

```
chatbot/
├── app.py                    # Home page
├── pages/
│   ├── 1_Upload_Docs.py      # Document upload and indexing
│   └── 2_Chat.py             # Checklist + chat interface
├── core/
│   ├── indexer.py             # PageIndex md_to_tree wrapper + caching
│   ├── retrieval.py           # Tree search (LLM-based + keyword)
│   ├── chat.py                # Claude streaming + question generation
│   └── checklist.py           # Onboarding checklist logic
├── config/
│   ├── settings.py            # App configuration from .env
│   └── checklist_config.json  # Customizable checklist questions
├── lib/PageIndex/             # Cloned PageIndex library
├── pageindex_cache/           # Cached tree JSONs
├── sample_docs/               # Sample documentation for testing
├── .streamlit/config.toml     # Streamlit theme config
├── requirements.txt
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

## How PageIndex Works

Unlike traditional RAG (chunk → embed → vector search), PageIndex:

1. **Parses** Markdown heading hierarchy (`#`, `##`, `###`, etc.) into a tree
2. **Summarizes** each section using an LLM
3. **Searches** by presenting the tree structure to Claude, which reasons about which sections are relevant
4. **Retrieves** the full text of identified sections as context for answering

This approach preserves document structure and enables reasoning about where information is likely to be found.

## License

MIT
