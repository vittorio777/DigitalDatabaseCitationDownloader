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
    // 获取总结果数量
    const resultsSpan = document.querySelector('span[data-test="results-data-total"]');
    let totalResults = 20; // 默认值
    if (resultsSpan) {
      const match = resultsSpan.textContent.match(/of (\d+) results/);
      if (match) {
        totalResults = parseInt(match[1]);
      }
    }

    const selectors = [
      'h3.c-card__title a[href*="/article/"]',
      'a.c-card__link[href*="/article/"]',
      'a.app-card-open__link[href*="/article/"] span',
      'a.app-card-open__link[href*="/chapter/"] span'
    ];
    
    const links = new Set();
    const titles = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(element => {
        // 如果是span元素，需要获取父元素的href
        const linkElement = element.tagName.toLowerCase() === 'span' ? element.parentElement : element;
        if (linkElement.href && (linkElement.href.includes('/article/') || linkElement.href.includes('/chapter/'))) {
          links.add(linkElement.href);
          // 获取论文标题
          const title = element.textContent.trim();
          if (title) {
            titles.add(title);
          }
        }
      });
    }

    const uniqueLinks = Array.from(links);
    if (uniqueLinks.length === 0) {
      return { success: false, error: '没有找到有效链接' };
    }

    await chrome.runtime.sendMessage({
      action: 'linksCollected',
      urls: uniqueLinks,
      titles: Array.from(titles),
      totalResults
    });

    // 获取下一页链接
    const nextPageButton = await waitForElement('a[data-test="next-page"]', 2000).catch(() => null);
    if (nextPageButton && !nextPageButton.classList.contains('disabled')) {
      const nextPageUrl = nextPageButton.href;
      if (nextPageUrl) {
        await chrome.runtime.sendMessage({ action: 'nextPageFound', url: nextPageUrl });
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 下载引用的具体实现
async function downloadCitation() {
  let retryCount = 0;
  const maxRetries = 2;
  const retryDelay = 2000; // 2秒延迟

  while (retryCount <= maxRetries) {
    try {
      // 判断页面类型
      const isArticle = window.location.href.includes('/article/');
      const isChapter = window.location.href.includes('/chapter/');
      
      // 根据页面类型选择对应的cite按钮选择器
      const citeSelector = isArticle
        ? 'a[href="#citeas"][data-track-action="cite this article"]'
        : 'a[href="#citeas"][data-track-action="cite this chapter"]';
      
      const citeButton = await waitForElement(citeSelector, 5000).catch(() => null);
      if (!citeButton) {
        if (retryCount === maxRetries) {
          return { success: false, error: '找不到Cite按钮' };
        }
        console.log(`尝试第${retryCount + 1}次重试...`);
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      citeButton.click();
      
      // 根据页面类型选择下载按钮选择器
      const downloadSelector = isArticle
        ? 'a[data-test="citation-link"][data-track-action="download article citation"]'
        : 'a[data-test="citation-link"][data-track-action="download chapter citation"]';
      
      const downloadButton = await waitForElement(downloadSelector, 5000).catch(() => null);
      if (!downloadButton) {
        if (retryCount === maxRetries) {
          return { success: false, error: '找不到Download citation按钮' };
        }
        console.log(`尝试第${retryCount + 1}次重试...`);
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      downloadButton.click();
      
      // 等待下载开始并确认下载状态
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true });
        }, 1500);
      });
    } catch (error) {
      console.error(`下载出错 (尝试 ${retryCount + 1}/${maxRetries + 1}):`, error);
      if (retryCount === maxRetries) {
        return { success: false, error: error.message };
      }
      retryCount++;
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
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