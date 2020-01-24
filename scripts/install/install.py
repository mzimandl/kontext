import os
import sys
import subprocess
import inspect
import argparse

KONTEXT_PATH = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
MANATEE_VER='2.167.8'

REQUIREMENTS = [
    'python3-pip',
    'wget',
    'curl',
    'openssh-server',
    'net-tools',
    'redis-server',
    'build-essential',
    'openssl',
    'pkg-config',
    'swig',
    'nginx',
    'npm',
    'libltdl7',
    'libpcre3',
    'libicu-dev',
    'libpcre++-dev',
    'libxml2-dev',
    'libxslt1-dev',
    'libltdl-dev',
    # required by manatee packages
    'm4',
    'parallel',
    'locales-all'
]


if __name__ == "__main__":
    argparser = argparse.ArgumentParser('Kontext instalation script')
    argparser.add_argument('--gunicorn', dest='install_gunicorn', action='store_true', default=False, help='Install gunicorn to run web server')
    argparser.add_argument('--patch', dest='patch_path', action='store', default=None, help='Path to UCNK Manatee patch')
    argparser.add_argument('--manatee-version', dest='manatee_version', action='store', default=MANATEE_VER, help='Set Manatee version')
    argparser.add_argument('-v', dest='verbose', action='store_true', default=False, help='Verbose mode')
    argparser.add_argument('--test', action='store_true', default=None, help='Test mode only installs basic dependencies')
    args = argparser.parse_args()

    if args.test:
        print('Running in test mode...')

    stdout = open(os.devnull, 'wb')
    if args.verbose or args.test:
        stdout = None

    # install prerequisites
    print('Installing requirements...')
    subprocess.check_call(['locale-gen', 'en_US.UTF-8'], stdout=stdout)
    subprocess.check_call(['apt-get', 'update', '-y'], stdout=stdout)
    subprocess.check_call(['apt-get', 'install', '-y'] + REQUIREMENTS, stdout=stdout)
    subprocess.check_call(['python3', '-m', 'pip', 'install', 'pip', '--upgrade'], stdout=stdout)
    subprocess.check_call(['pip3', 'install', 'simplejson', 'celery', 'signalfd', '-r', 'requirements.txt'], cwd=KONTEXT_PATH, stdout=stdout)

    # import steps here, because some depend on packages installed by this script
    import steps

    # test section
    if args.test:
        steps.SetupManatee(KONTEXT_PATH, stdout)
        steps.SetupKontext(KONTEXT_PATH, stdout)
        steps.SetupDefaultUsers(KONTEXT_PATH, stdout)
        steps.SetupGunicorn(KONTEXT_PATH, stdout)
        print('Test successful')
        sys.exit(0)

    # run installation steps
    steps.SetupManatee(KONTEXT_PATH, stdout).run(args.manatee_version, args.patch_path)
    steps.SetupKontext(KONTEXT_PATH, stdout).run()
    steps.SetupDefaultUsers(KONTEXT_PATH, stdout).run()
    if args.install_gunicorn:
        steps.SetupGunicorn(KONTEXT_PATH, stdout).run()

    # finalize instalation
    print('Initializing celery and nginx services...')
    subprocess.check_call(['systemctl', 'start', 'celery'], stdout=stdout)
    subprocess.check_call(['systemctl', 'restart', 'nginx'], stdout=stdout)
    if args.install_gunicorn:
        print('Initializing gunicorn...')
        subprocess.check_call(['systemctl', 'start', 'gunicorn'], stdout=stdout)

    # print final messages
    print(inspect.cleandoc(f'''
        {steps.bcolors.BOLD}{steps.bcolors.OKGREEN}
        KonText installation successfully completed.
        To start KonText, enter the following command in the KonText install root directory (i.e. {KONTEXT_PATH}):
        
            sudo -u {steps.WEBSERVER_USER} python3 public/app.py --address 127.0.0.1 --port 8080

        (--address and --port parameters are optional; default serving address is 127.0.0.1:5000)
        or you can use Gunicorn instead.
        {steps.bcolors.ENDC}{steps.bcolors.ENDC}
    '''))

    for message in steps.InstallationStep.final_messages:
        print(inspect.cleandoc(message))
