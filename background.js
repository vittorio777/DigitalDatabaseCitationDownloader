// 存储任务的状态
let tasks = {
  total: 0,
  downloadedCount: 0,  // 已下载的文献数量
  urls: [],
  titles: [],
  tabId: null,
  currentTabId: null,
  isRunning: false,
  processedUrls: new Set(),
  nextPageUrl: null
};

// 初始化时从storage恢复状态
chrome.storage.local.get(['downloadState']).then(data => {
  if (data.downloadState && data.downloadState.isDownloading) {
    tasks.isRunning = true;
    tasks.current = data.downloadState.current;
    tasks.total = data.downloadState.total;
  }
});

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
    tasks.urls = tasks.urls.concat(message.urls);
    tasks.titles = tasks.titles.concat(message.titles);
    if (message.totalResults) {
      tasks.total = message.totalResults;
    }
    // 保存论文标题到storage
    chrome.storage.local.set({
      paperTitles: tasks.titles
    });
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
  tasks.downloadedCount = 0;
  tasks.currentTabId = null;
  tasks.nextPageUrl = null;
  tasks.processedUrls.clear();
}

// 处理下一个链接
async function processNextUrl() {
  try {
    if (tasks.processedUrls.size >= tasks.urls.length) {
      if (tasks.nextPageUrl) {
        console.log('当前页面处理完成，跳转到下一页:', tasks.nextPageUrl);
        const nextPageTab = await chrome.tabs.create({ url: tasks.nextPageUrl, active: false });
        tasks.tabId = nextPageTab.id;
        tasks.nextPageUrl = null;
        tasks.urls = [];
        tasks.processedUrls.clear(); // 清空已处理的URL集合
        
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
      // 获取存储的论文标题
      const data = await chrome.storage.local.get(['paperTitles']);
      if (data.paperTitles && data.paperTitles.length > 0) {
        try {
          // 生成带序号的txt文件内容并直接下载
          const content = data.paperTitles.map((title, index) => `${index + 1}. ${title}`).join('\n');
          // 使用Data URL直接下载文件
          const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
          await chrome.downloads.download({
            url: dataUrl,
            filename: 'paper_titles.txt',
            saveAs: false
          });
        } catch (error) {
          console.error('下载文件时出错:', error);
          chrome.runtime.sendMessage({
            type: 'error',
            error: `下载文件时出错: ${error.message}`
          });
        }
      }
      
      await Promise.all([
        chrome.storage.local.remove(['downloadState', 'paperTitles']),
        chrome.runtime.sendMessage({ type: 'complete' })
      ]);
      stopDownload();
      return;
    }

    const url = tasks.urls.find(url => !tasks.processedUrls.has(url));
    if (!url) {
      console.log('没有未处理的链接');
      if (tasks.isRunning) {
        setTimeout(processNextUrl, 1000);
      }
      return;
    }

    console.log(`开始处理第${tasks.current + 1}个链接:`, url);
    tasks.processedUrls.add(url);

    // 在新标签页打开论文详情页
    const tab = await chrome.tabs.create({ url, active: false });
    tasks.currentTabId = tab.id;

    // 等待页面加载完成
    await new Promise(resolve => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // 添加超时处理
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);
    });

    // 等待页面加载并下载引用
    await new Promise(resolve => setTimeout(resolve, 2000));
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'downloadCitation' });
      // 下载开始后立即关闭标签页
      if (response && response.success) {
        try {
          await chrome.tabs.remove(tab.id);
          tasks.currentTabId = null;
        } catch (error) {
          console.error('关闭标签页失败:', error);
        }
      }
    } catch (error) {
      console.error('发送下载消息失败:', error);
      response = { success: false };
    }
    
    if (!response || !response.success) {
      console.log('下载失败，跳过当前链接');
      chrome.runtime.sendMessage({
        type: 'error',
        error: '下载失败，已跳过'
      });
      // 关闭标签页
      try {
        await chrome.tabs.remove(tab.id);
      } catch (error) {
        console.error('关闭标签页失败:', error);
      }
      if (tasks.isRunning) {
        setTimeout(processNextUrl, 2000);
      }
      return;
    }

    // 更新下载计数
    tasks.downloadedCount++;
    // 同时更新storage和发送消息
    const progressData = {
      type: 'progress',
      current: tasks.downloadedCount,
      total: tasks.total
    };
    await Promise.all([
      chrome.storage.local.set({
        downloadState: {
          isDownloading: true,
          current: tasks.downloadedCount,
          total: tasks.total
        }
      }),
      chrome.runtime.sendMessage(progressData)
    ]);

    // 标签页已在下载开始时关闭

    // 继续处理下一个链接
    if (tasks.isRunning) {
      setTimeout(processNextUrl, 2000);
    }
  } catch (error) {
    console.error('处理链接时出错:', error);
    chrome.runtime.sendMessage({
      type: 'error',
      error: `处理链接时出错: ${error.message}`
    });
    if (tasks.isRunning) {
      setTimeout(processNextUrl, 2000);
    }
  }
}