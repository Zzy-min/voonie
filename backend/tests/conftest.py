import os


# Unit and integration tests must never consume locally configured paid providers.
os.environ["ARK_API_KEY"] = ""
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["LOCAL_ASR_ENABLED"] = "false"
