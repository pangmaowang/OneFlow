import "./style.css"

import { PopupView } from "./popup/components/popup-view"
import { usePopupLogic } from "./popup/hooks/use-popup-logic"

function IndexPopup() {
  const viewModel = usePopupLogic()
  return <PopupView {...viewModel} />
}

export default IndexPopup
