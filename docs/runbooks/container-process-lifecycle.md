# Container process lifecycle

The runtime installs Ubuntu Noble's official `tini` package alongside FFmpeg.
Tini runs as PID 1 and starts Java as its direct child, under the existing
`10001:10001` application user. The Java arguments remain
`-Djava.awt.headless=true -jar /app/app.jar`.

This gives the container an init process that reaps adopted children, forwards
signals to Java and preserves its exit status. The entrypoint uses Tini's default
signal behavior, without process-group or exit-code remapping options. See the
[Ubuntu package](https://packages.ubuntu.com/noble/tini) and
[Tini documentation](https://github.com/krallin/tini).

Pre-cutover inspection observed adopted SSH descendants remaining as zombies
when Java was PID 1. This establishes a process-lifecycle defect. It does not
establish that PID or memory exhaustion caused an interrupted backup read.

Before accepting a deployment, verify Tini's exact PID-1 command, one direct Java
child, its exact command/JAR identity and current runtime inputs. Historical
checks that expect Java itself to be PID 1 cannot establish this new process
shape. Keep their original evidence and use the separately reviewed versioned
guard for the new release. Re-run source binding and recovery acceptance for the
exact deployed commit; an init-process change alone supplies no backup or launch
acceptance.
