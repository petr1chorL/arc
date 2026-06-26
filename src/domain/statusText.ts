const mojibakeStatus: Record<string, string> = {
  '宸插畬鎴?': '已完成',
  '宸插彂甯?': '已发布',
  '鏈彂甯?': '未发布',
  '鑽夌': '草稿',
  '鍦ㄧ嚎': '在线',
  '宸插仠鐢?': '已停用',
  '澶辫触': '失败',
  '宸查€氳繃': '已通过',
  '淇敼鍚庨€氳繃': '修改后通过',
  '宸查┏鍥?': '已驳回',
  '宸查€€鍥?': '已退回',
  '鎭㈠澶辫触': '恢复失败',
  '瀹℃牳涓?': '审核中',
  '寰呰棰?': '待认领',
  '绛夊緟瀹℃牳': '等待审核',
  '宸茬‘璁?': '已确认',
  '姝ｅ父': '正常',
  '鍗冲皢鍒版湡': '即将到期',
  '宸查€炬湡': '已逾期',
  '宸插崌绾?': '已升级',
}

export function displayStatus(status: string) {
  return mojibakeStatus[status] ?? status
}

export function isWaitingForHumanReview(status: string) {
  return displayStatus(status) === '需介入'
}
