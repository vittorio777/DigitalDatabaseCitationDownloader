// RIS文件合并和校对功能
async function mergeRisFiles(risFiles, titleFile) {
  try {
    // 读取标题文件
    const titleText = await titleFile.text();
    const titles = titleText.split('\n')
      .map(line => line.replace(/^\d+\.\s*/, '').trim()) // 移除序号
      .filter(title => title.length > 0);

    // 读取并合并RIS文件
    const risContents = await Promise.all(
      Array.from(risFiles).map(file => file.text())
    );

    // 解析RIS文件中的标题
    const risRecords = [];
    const risRecordTitles = new Set();
    let currentRecord = '';

    for (const content of risContents) {
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.startsWith('TY  -')) {
          if (currentRecord) {
            risRecords.push(currentRecord);
          }
          currentRecord = line + '\n';
        } else if (line.startsWith('TI  -')) {
          const title = line.substring(6).trim();
          risRecordTitles.add(title);
          currentRecord += line + '\n';
        } else if (line.trim()) {
          currentRecord += line + '\n';
        }
      }
    }
    if (currentRecord) {
      risRecords.push(currentRecord);
    }

    // 生成校对报告
    const missingTitles = titles.filter(title => !risRecordTitles.has(title));
    const report = `校对报告：\n\n成功下载的文献：${risRecordTitles.size}篇\n` +
      `总文献数：${titles.length}篇\n\n` +
      `未成功下载的文献（${missingTitles.length}篇）：\n` +
      missingTitles.map((title, index) => `${index + 1}. ${title}`).join('\n');

    // 创建合并后的RIS文件和校对报告的Blob
    const mergedRis = risRecords.join('\n');
    const risBlob = new Blob([mergedRis], { type: 'application/x-research-info-systems' });
    const reportBlob = new Blob([report], { type: 'text/plain' });
    
    // 创建下载链接
    const risUrl = URL.createObjectURL(risBlob);
    const reportUrl = URL.createObjectURL(reportBlob);
    
    // 先让用户选择保存位置
    const risDownload = await chrome.downloads.download({
      url: risUrl,
      filename: 'merged_citations.ris',
      saveAs: true
    });
    
    // 使用相同目录保存校对报告
    const reportDownload = await chrome.downloads.download({
      url: reportUrl,
      filename: 'verification_report.txt',
      saveAs: false
    });

    return { success: true };
  } catch (error) {
    console.error('合并RIS文件时出错:', error);
    return { success: false, error: error.message };
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  const startButton = document.getElementById('startDownload');
  const mergeButton = document.getElementById('mergeRis');
  const risFilesInput = document.getElementById('risFiles');
  const titleFileInput = document.getElementById('titleFile');
  const mergeStatusText = document.getElementById('mergeStatus');
  const stopButton = document.getElementById('stopDownload');
  const progressDiv = document.getElementById('progress');

  // 监听合并按钮点击事件
  mergeButton.addEventListener('click', async function() {
    try {
      // 验证文件选择
      if (risFilesInput.files.length === 0) {
        mergeStatusText.textContent = '请选择至少一个RIS文件';
        return;
      }
      if (!titleFileInput.files[0]) {
        mergeStatusText.textContent = '请选择标题文件';
        return;
      }

      mergeButton.disabled = true;
      mergeStatusText.textContent = '正在处理文件...';

      // 执行合并操作
      const result = await mergeRisFiles(risFilesInput.files, titleFileInput.files[0]);

      if (result.success) {
        mergeStatusText.textContent = '合并完成！已生成合并后的RIS文件和校对报告。';
      } else {
        mergeStatusText.textContent = `合并失败: ${result.error}`;
      }
    } catch (error) {
      mergeStatusText.textContent = `操作失败: ${error.message}`;
    } finally {
      mergeButton.disabled = false;
    }
  });
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