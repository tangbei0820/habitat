import { usePhotoCollectionSettings } from './usePhotoCollectionSettings'

interface SourceRowProps {
  checked: boolean
  label: string
  description: string
  testId: string
  onChange: (value: boolean) => void
}

function SourceRow({ checked, label, description, testId, onChange }: SourceRowProps) {
  return (
    <label className="setting-row" data-testid={testId}>
      <div className="setting-row-main">
        <div className="setting-row-title">{label}</div>
        <div className="setting-row-sub">{description}</div>
      </div>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function PhotoCollectionSettings() {
  const collectUserSent = usePhotoCollectionSettings((state) => state.collectUserSent)
  const collectAssistantSent = usePhotoCollectionSettings((state) => state.collectAssistantSent)
  const collectAssistantGenerated = usePhotoCollectionSettings((state) => state.collectAssistantGenerated)
  const setCollectUserSent = usePhotoCollectionSettings((state) => state.setCollectUserSent)
  const setCollectAssistantSent = usePhotoCollectionSettings((state) => state.setCollectAssistantSent)
  const setCollectAssistantGenerated = usePhotoCollectionSettings((state) => state.setCollectAssistantGenerated)

  return (
    <>
      <div className="setting-group-label">相册</div>
      <section className="setting-group" style={{ marginTop: 0 }} data-testid="photo-collection-settings">
        <div className="setting-row" style={{ display: 'block' }}>
          <div className="setting-row-title">自动收集聊天图片</div>
          <div className="setting-row-sub" style={{ marginTop: 3 }}>
            默认关闭。只影响之后的新消息；关闭后不会删除已经收进相册的照片。原图会占用本机空间，也会进入本地备份。
          </div>
        </div>
        <SourceRow
          checked={collectUserSent}
          label="我发送的图片"
          description="把聊天里由你发送的图片自动加入相册"
          testId="photo-auto-collect-user"
          onChange={setCollectUserSent}
        />
        <SourceRow
          checked={collectAssistantSent}
          label="小栖发送的图片"
          description="把聊天里小栖发送的普通图片自动加入相册"
          testId="photo-auto-collect-assistant"
          onChange={setCollectAssistantSent}
        />
        <SourceRow
          checked={collectAssistantGenerated}
          label="小栖生成的图片"
          description="把通过生图能力生成的图片自动加入相册"
          testId="photo-auto-collect-generated"
          onChange={setCollectAssistantGenerated}
        />
      </section>
    </>
  )
}

