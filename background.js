// 存储任务的状态
let tasks = {
  total: 0,
  current: 0,
  urls: [],
  tabId: null,
  currentTabId: null,
  isRunning: false,
  processedUrls: new Set(),
  nextPageUrl: null
};

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'nextPageFound') {
    if (!tasks.isRunning) return;
    console.log('发现下一页:', message.url);
    // 当前页面的链接处理完成后，跳转到下一页
    tasks.nextPageUrl = message.url;
  } else if (message.action === 'startDownload') {
    if (tasks.isRunning) {
      console.warn('已有下载任务正在运行');
      return;
    }
    console.log('开始新的下载任务...');
    tasks.isRunning = true;
    tasks.tabId = message.tabId;
    tasks.urls = [];
    tasks.total = 0;
    tasks.current = 0;
    // 向content script发送消息，开始收集链接
    chrome.tabs.sendMessage(message.tabId, { action: 'collectLinks' });
  } else if (message.action === 'linksCollected') {
    if (!tasks.isRunning) {
      console.warn('没有正在运行的下载任务');
      return;
    }
    if (!message.urls || !Array.isArray(message.urls)) {
      console.error('收到无效的链接数据');
      chrome.runtime.sendMessage({ type: 'error', error: '收到无效的链接数据' });
      return;
    }
    console.log('收到收集到的链接:', message.urls);
    tasks.urls = message.urls;
    tasks.total = message.urls.length;
    tasks.current = 0;
    if (tasks.total === 0) {
      console.warn('没有找到可下载的链接');
      chrome.runtime.sendMessage({ type: 'error', error: '没有找到可下载的链接' });
      return;
    }
    console.log('开始处理队列，总共', tasks.total, '个链接');
    processNextUrl();
  } else if (message.action === 'stopDownload') {
    stopDownload();
  }
});

// 停止下载
async function stopDownload() {
  tasks.isRunning = false;
  if (tasks.currentTabId) {
    try {
      await chrome.tabs.remove(tasks.currentTabId);
    } catch (error) {
      console.error('关闭标签页时出错:', error);
    }
  }
  // 重置任务状态
  tasks.urls = [];
  tasks.total = 0;
  tasks.current = 0;
  tasks.currentTabId = null;
  tasks.nextPageUrl = null;
  tasks.processedUrls.clear();
}

// 处理下一个链接
async function processNextUrl() {
  if (tasks.current >= tasks.total) {
    if (tasks.nextPageUrl) {
      console.log('当前页面处理完成，跳转到下一页:', tasks.nextPageUrl);
      const nextPageTab = await chrome.tabs.create({ url: tasks.nextPageUrl, active: false });
      tasks.tabId = nextPageTab.id;
      tasks.nextPageUrl = null;
      tasks.urls = [];
      tasks.total = 0;
      tasks.current = 0;
      
      // 等待页面加载完成
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === nextPageTab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
      
      // 收集新页面的链接
      await new Promise(resolve => setTimeout(resolve, 2000));
      chrome.tabs.sendMessage(nextPageTab.id, { action: 'collectLinks' });
      return;
    }
    console.log('所有页面处理完成');
    chrome.runtime.sendMessage({ type: 'complete' });
    stopDownload();
    return;
  }

  const url = tasks.urls[tasks.current];
  console.log(`开始处理第${tasks.current + 1}个链接:`, url);

  // 在新标签页打开论文详情页
  const tab = await chrome.tabs.create({ url, active: false });
  tasks.currentTabId = tab.id;

  // 等待页面加载完成
  await new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  // 等待页面加载并下载引用
  await new Promise(resolve => setTimeout(resolve, 2000));
  const response = await chrome.tabs.sendMessage(tab.id, { action: 'downloadCitation' });
  if (!response || !response.success) {
    console.log('下载失败，跳过当前链接');
    tasks.current++;
    await chrome.tabs.remove(tab.id);
    if (tasks.isRunning) {
      setTimeout(processNextUrl, 2000);
    }
    return;
  }
  // 等待下载开始
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 更新进度
  tasks.current++;
  chrome.runtime.sendMessage({
    type: 'progress',
    current: tasks.current,
    total: tasks.total
  });

  // 关闭标签页
  await chrome.tabs.remove(tab.id);

  // 继续处理下一个链接
  if (tasks.isRunning) {
    setTimeout(processNextUrl, 2000);
  }
}