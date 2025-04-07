document.addEventListener('DOMContentLoaded', function() {
  const startButton = document.getElementById('startDownload');
  const stopButton = document.getElementById('stopDownload');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.querySelector('.progress-fill');
  const statusText = document.querySelector('.status');

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
      const messageListener = function(message) {
        if (message.type === 'progress') {
          const percent = (message.current / message.total) * 100;
          progressFill.style.width = `${percent}%`;
          statusText.textContent = `正在下载第 ${message.current} 篇，共 ${message.total} 篇`;
        } else if (message.type === 'complete') {
          statusText.textContent = '下载完成！';
          startButton.disabled = false;
          stopButton.style.display = 'none';
          chrome.runtime.onMessage.removeListener(messageListener);
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
  });
});