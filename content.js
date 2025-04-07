// 监听来自background script的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadCitation') {
    downloadCitation().then(success => sendResponse({ success }));
    return true;
  }
  if (message.action === 'collectLinks') {
    collectLinks().then(sendResponse);
    return true;
  }
});

// 收集论文链接
async function collectLinks() {
  try {
    const selectors = [
      'h3.c-card__title a[href*="/article/"]',
      'a.c-card__link[href*="/article/"]',
      'a.app-card-open__link[href*="/article/"]',
      'a.app-card-open__link[href*="/chapter/"]'
    ];
    
    const links = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(element => {
        if (element.href && (element.href.includes('/article/') || element.href.includes('/chapter/'))) {
          links.add(element.href);
        }
      });
    }

    const uniqueLinks = Array.from(links);
    if (uniqueLinks.length === 0) {
      return { success: false, error: '没有找到有效链接' };
    }

    await chrome.runtime.sendMessage({ action: 'linksCollected', urls: uniqueLinks });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 下载引用的具体实现
async function downloadCitation() {
  try {
    await waitForElement('.c-article-header');
    const citeButton = await waitForElement('a[href="#citeas"][data-track-action^="cite this"]', 15000);
    citeButton.click();
    
    await waitForElement('.c-citation-download, .c-article-references', 30000);
    
    const downloadSelectors = [
      '.c-citation-download a[href="#"]',
      'button[data-test="download-citation"]',
      'a[data-test="citation-link"]',
      '.c-citation-download__button',
      '.c-article-references a[data-test="citation-link"]',
      'button[data-track-action^="download citation"]',
      'button[data-track-action^="download chapter citation"]'
    ];

    let downloadButton;
    for (const selector of downloadSelectors) {
      downloadButton = await waitForElement(selector, 2000).catch(() => null);
      if (downloadButton) break;
    }
    if (!downloadButton) throw new Error('找不到Download citation按钮');
    downloadButton.click();
    
    await waitForElement('.c-citation-download__format-list', 10000);
    const risOption = await waitForElement('input[value=".ris"]', 5000);
    risOption.click();
    
    const downloadCitationButton = await waitForElement('button[data-test="download-citation-button"]', 5000);
    downloadCitationButton.click();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    return false;
  }
}

// 等待元素出现的辅助函数
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`等待元素 ${selector} 超时`));
    }, timeout);
  });
}