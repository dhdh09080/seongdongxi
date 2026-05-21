name: Hourly Weather Snapshot

# 언제 이 작업을 실행할 것인지 정의
on:
  schedule:
    - cron: '0 * * * *'  # 매시간 정각마다 자동으로 실행
  workflow_dispatch:     # 우리가 테스트해 보고 싶을 때 수동으로 실행할 수 있는 버튼을 만들어줌

jobs:
  run-weather-bot:
    runs-on: ubuntu-latest
    
    # 깃허브의 잔소리를 잠재우기 위해 강제로 Node 24 버전을 사용하도록 설정
    env: 
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

    steps:
    # 1. 저장소의 코드를 가상 서버로 가져옴
    - name: 저장소 체크아웃
      uses: actions/checkout@v4

    # 2. 파이썬 환경 세팅
    - name: 파이썬 설치
      uses: actions/setup-python@v5
      with:
        python-version: '3.10'

    # 3. 필요한 라이브러리 설치
    - name: 패키지 설치
      run: |
        python -m pip install --upgrade pip
        pip install requests pillow

    # 4. 날씨 스냅샷 생성 파이썬 코드 실행 (금고에서 API 키를 꺼내서 전달)
    - name: 스냅샷 스크립트 실행
      env:
        WEATHER_API_KEY: ${{ secrets.WEATHER_API_KEY }}
      run: python weather_api.py

    # 5. 새로 생성된 이미지 파일을 GitHub 저장소에 자동 커밋 및 푸시
    - name: 결과물 GitHub에 자동 저장
      run: |
        git config --local user.email "action@github.com"
        git config --local user.name "GitHub Action Bot"
        git add .
        git commit -m "Auto-update: 현장 기상 스냅샷 추가" || echo "No changes to commit"
        git push
