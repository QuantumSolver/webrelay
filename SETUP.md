# Setup Instructions

## Create the GitHub Repository

The personal access token doesn't have permission to create repositories. Please create the repository manually:

### Option 1: Create via GitHub Web UI

1. Go to https://github.com/new
2. Repository name: `webrelay`
3. Description: `A modern webhook relay system with Redis Streams`
4. Keep it **Public**
5. **Do NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

### Option 2: Create via GitHub CLI (if installed)

```bash
gh repo create webrelay --public --description "A modern webhook relay system with Redis Streams"
```

## Push to GitHub

After creating the repository, run:

```bash
cd /home/z/my-project

# Push to GitHub
git push -u origin master
```

Or with your token:
```bash
git push https://github_pat_YOUR_TOKEN@github.com/QuantumSolver/webrelay.git master
```

## Enable GitHub Packages

After pushing, enable GitHub Packages for Docker images:

1. Go to repository Settings > Actions > General
2. Under "Workflow permissions", select "Read and write permissions"
3. Check "Allow GitHub Actions to create and approve pull requests"
4. Click Save

## Next Steps

1. Create a `LICENSE` file (MIT recommended)
2. Add repository topics: `webhook`, `relay`, `redis`, `nextjs`, `docker`
3. Set up branch protection rules for `main`
4. Create release tags to trigger Docker builds

## Docker Images

After pushing, GitHub Actions will automatically build and push images to:
- `ghcr.io/quantumsolver/webrelay-server:latest`
- `ghcr.io/quantumsolver/webrelay-client:latest`
- `ghcr.io/quantumsolver/webrelay-realtime:latest`
