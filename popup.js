document.addEventListener('DOMContentLoaded', async function() {
  const startButton = document.getElementById('startDownload');
  const stopButton = document.getElementById('stopDownload');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.querySelector('.progress-fill');
  const statusText = document.querySelector('.status');

  // 从storage中恢复状态
  try {
    const data = await chrome.storage.local.get(['downloadState']);
    
    if (data.downloadState) {
      const { isDownloading, current, total } = data.downloadState;
      if (isDownloading) {
        startButton.disabled = true;
        stopButton.style.display = 'block';
        if (total > 0) {
          const percent = (current / total) * 100;
          progressFill.style.width = `${percent}%`;
          statusText.textContent = `已处理 ${current} 篇，共 ${total} 篇`;
        }
      }
    }
  } catch (error) {
    console.error('恢复状态时出错:', error);
    // 出错时清除可能损坏的状态
    chrome.storage.local.remove('downloadState');
    startButton.disabled = false;
    stopButton.style.display = 'none';
    statusText.textContent = '准备就绪';
  }

  startButton.addEventListener('click', async function() {
    startButton.disabled = true;
    stopButton.style.display = 'block';
    
    try {
      // 获取当前标签页
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      
      // 发送消息给background script开始下载
      chrome.runtime.sendMessage({
        action: 'startDownload',
        tabId: tab.id
      });

      // 监听下载进度
      const messageListener = async function(message) {
        if (message.type === 'progress') {
          const percent = (message.current / message.total) * 100;
          progressFill.style.width = `${percent}%`;
          statusText.textContent = `已处理 ${message.current} 篇，共 ${message.total} 篇`;
          // 保存当前状态
          chrome.storage.local.set({
            downloadState: {
              isDownloading: true,
              current: message.current,
              total: message.total
            }
          });
        } else if (message.type === 'complete') {
          statusText.textContent = '下载完成！';
          startButton.disabled = false;
          stopButton.style.display = 'none';
          chrome.runtime.onMessage.removeListener(messageListener);
          // 清除下载状态
          chrome.storage.local.remove('downloadState');
        } else if (message.type === 'error') {
          statusText.textContent = `下载出错: ${message.error}`;
          startButton.disabled = false;
          stopButton.style.display = 'none';
          chrome.runtime.onMessage.removeListener(messageListener);
        }
      };
      
      chrome.runtime.onMessage.addListener(messageListener);
    } catch (error) {
      statusText.textContent = `操作失败: ${error.message}`;
      startButton.disabled = false;
      stopButton.style.display = 'none';
    }
  });

  stopButton.addEventListener('click', function() {
    chrome.runtime.sendMessage({ action: 'stopDownload' });
    statusText.textContent = '已终止下载';
    startButton.disabled = false;
    stopButton.style.display = 'none';
    // 清除下载状态
    chrome.storage.local.remove('downloadState');
  });
});