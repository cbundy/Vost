FROM ghcr.io/cbundy/dev-system/base:2

USER root

# Playwright Chromium for `npm run e2e:capture`. The version below must equal
# package.json devDependencies.playwright; scripts/devcontainer-playwright.test.ts guards it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.64.1 install --with-deps chromium \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright

USER node
