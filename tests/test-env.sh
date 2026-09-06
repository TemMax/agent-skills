# Hermetic settings for disposable repositories created by tests.
# Never source this file from release/build code or before a real repo commit.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=commit.gpgsign
export GIT_CONFIG_VALUE_0=false
export GIT_CONFIG_KEY_1=init.defaultBranch
export GIT_CONFIG_VALUE_1=master
