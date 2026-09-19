import os


# Unit and integration tests must never consume locally configured paid providers.
os.environ["ARK_API_KEY"] = ""
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["LOCAL_ASR_ENABLED"] = "false"
# Most feature tests construct legacy device/email identities directly. The
# dedicated auth suite enables the production WeChat gate explicitly.
os.environ["REQUIRE_WECHAT_BINDING"] = "false"
