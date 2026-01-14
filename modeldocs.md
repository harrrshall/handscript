# Secrets

Securely provide credentials and other sensitive information to your Modal Functions with Secrets.

You can create and edit Secrets via
the [dashboard](/secrets),
the command line interface ([`modal secret`](/docs/reference/cli/secret)), and
programmatically from Python code ([`modal.Secret`](/docs/reference/modal.Secret)).

To inject Secrets into the container running your Function, add the
`secrets=[...]` argument to your `app.function` or `app.cls` decoration.

## Deploy Secrets from the Modal Dashboard

The most common way to create a Modal Secret is to use the
[Secrets panel of the Modal dashboard](/secrets),
which also shows any existing Secrets.

When you create a new Secret, you'll be prompted with a number of templates to help you get started.
These templates demonstrate standard formats for credentials for everything from Postgres and MongoDB
to Weights & Biases and Hugging Face.

## Use Secrets in your Modal Apps

You can then use your Secret by constructing it `from_name` when defining a Modal App
and then accessing its contents as environment variables.
For example, if you have a Secret called `secret-keys` containing the key
`MY_PASSWORD`:

```python
@app.function(secrets=[modal.Secret.from_name("secret-keys")])
def some_function():
    import os

    secret_key = os.environ["MY_PASSWORD"]
    ...
```

Each Secret can contain multiple keys and values but you can also inject
multiple Secrets, allowing you to separate Secrets into smaller reusable units:

```python
@app.function(secrets=[
    modal.Secret.from_name("my-secret-name"),
    modal.Secret.from_name("other-secret"),
])
def other_function():
    ...
```

The Secrets are applied in order, so key-values from later `modal.Secret`
objects in the list will overwrite earlier key-values in the case of a clash.
For example, if both `modal.Secret` objects above contained the key `FOO`, then
the value from `"other-secret"` would always be present in `os.environ["FOO"]`.

## Create Secrets programmatically

In addition to defining Secrets on the web dashboard, you can
programmatically create a Secret directly in your script and send it along to
your Function using `Secret.from_dict(...)`. This can be useful if you want to
send Secrets from your local development machine to the remote Modal App.

```python
import os

if modal.is_local():
    local_secret = modal.Secret.from_dict({"FOO": os.environ["LOCAL_FOO"]})
else:
    local_secret = modal.Secret.from_dict({})


@app.function(secrets=[local_secret])
def some_function():
    import os

    print(os.environ["FOO"])
```

If you have [`python-dotenv`](https://pypi.org/project/python-dotenv/) installed,
you can also use `Secret.from_dotenv()` to create a Secret from the variables in a `.env`
file

```python
@app.function(secrets=[modal.Secret.from_dotenv()])
def some_other_function():
    print(os.environ["USERNAME"])
```

## Interact with Secrets from the command line

You can create, list, and delete your Modal Secrets with the `modal secret` command line interface.

View your Secrets and their timestamps with

```bash
modal secret list
```

Create a new Secret by passing `{KEY}={VALUE}` pairs to `modal secret create`:

```bash
modal secret create database-secret PGHOST=uri PGPORT=5432 PGUSER=admin PGPASSWORD=hunter2
```

or using environment variables (assuming below that the `PGPASSWORD` environment variable is set
e.g. by your CI system):

```bash
modal secret create database-secret PGHOST=uri PGPORT=5432 PGUSER=admin PGPASSWORD="$PGPASSWORD"
```

Remove Secrets by passing their name to `modal secret delete`:

```bash
modal secret delete database-secret
```
# Volumes

Modal Volumes provide a high-performance distributed file system for your Modal applications.
They are designed for write-once, read-many I/O workloads, like creating machine learning model
weights and distributing them for inference.

This page is a high-level guide to using Modal Volumes.
For reference documentation on the `modal.Volume` object, see
[this page](/docs/reference/modal.Volume).
For reference documentation on the `modal volume` CLI command, see
[this page](/docs/reference/cli/volume).

## Volumes v2

A new generation of the file system, Volumes v2, is now available as a
beta preview.

> 🌱 Instructions that are specific to v2 Volumes will be annotated with 🌱
> below.

Read more about [Volumes v2](#volumes-v2-overview) below.

## Creating a Volume

The easiest way to create a Volume and use it as a part of your App is to use
the [`modal volume create`](/docs/reference/cli/volume#modal-volume-create) CLI command. This will create the Volume and output
some sample code:

```bash
% modal volume create my-volume
Created volume 'my-volume' in environment 'main'.
```

> 🌱 To create a v2 Volume, pass `--version=2` in the command above.

## Using a Volume on Modal

To attach an existing Volume to a Modal Function, use [`Volume.from_name`](/docs/reference/modal.Volume#from_name):

```python
vol = modal.Volume.from_name("my-volume")


@app.function(volumes={"/data": vol})
def run():
    with open("/data/xyz.txt", "w") as f:
        f.write("hello")
    vol.commit()  # Needed to make sure all changes are persisted before exit
```

You can also browse and manipulate Volumes from an ad hoc Modal Shell:

```bash
% modal shell --volume my-volume --volume another-volume
```

Volumes will be mounted under `/mnt`.

Volumes are designed to provide up to 2.5 GB/s of bandwidth.
Actual throughput is not guaranteed and may be lower depending on network conditions.

## Downloading a file from a Volume

While there’s no file size limit for individual files in a volume, the frontend only supports downloading files up to 16 MB. For larger files, please use the CLI:

```bash
% modal volume get my-volume xyz.txt xyz-local.txt
```

### Creating Volumes lazily from code

You can also create Volumes lazily from code using:

```python
vol = modal.Volume.from_name("my-volume", create_if_missing=True)
```

> 🌱 To create a v2 Volume, pass `version=2` to the call to `from_name()` in the code above.

This will create the Volume if it doesn't exist.

## Using a Volume from outside of Modal

Volumes can also be used outside Modal via the [Python SDK](/docs/reference/modal.Volume#modalvolume) or our [CLI](/docs/reference/cli/volume).

### Using a Volume from local code

You can interact with Volumes from anywhere you like using the `modal` Python client library.

```python notest
vol = modal.Volume.from_name("my-volume")

with vol.batch_upload() as batch:
    batch.put_file("local-path.txt", "/remote-path.txt")
    batch.put_directory("/local/directory/", "/remote/directory")
    batch.put_file(io.BytesIO(b"some data"), "/foobar")
```

For more details, see the [reference documentation](/docs/reference/modal.Volume).

### Using a Volume via the command line

You can also interact with Volumes using the command line interface. You can run
`modal volume` to get a full list of its subcommands:

```bash
% modal volume
Usage: modal volume [OPTIONS] COMMAND [ARGS]...

 Read and edit modal.Volume volumes.
 Note: users of modal.NetworkFileSystem should use the modal nfs command instead.

╭─ Options ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                                                                                                                            │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ File operations ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ cp       Copy within a modal.Volume. Copy source file to destination file or multiple source files to destination directory.                                                                           │
│ get      Download files from a modal.Volume object.                                                                                                                                                    │
│ ls       List files and directories in a modal.Volume volume.                                                                                                                                          │
│ put      Upload a file or directory to a modal.Volume.                                                                                                                                                 │
│ rm       Delete a file or directory from a modal.Volume.                                                                                                                                               │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Management ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ create   Create a named, persistent modal.Volume.                                                                                                                                                      │
│ delete   Delete a named, persistent modal.Volume.                                                                                                                                                      │
│ list     List the details of all modal.Volume volumes in an Environment.                                                                                                                               │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

For more details, see the [reference documentation](/docs/reference/cli/volume).

## Volume commits and reloads

Unlike a normal filesystem, you need to explicitly reload the Volume to see
changes made since it was first mounted. This reload is handled by invoking the
[`.reload()`](/docs/reference/modal.Volume#reload) method on a Volume object.
Similarly, any Volume changes made within a container need to be committed for
those the changes to become visible outside the current container. This is handled
periodically by [background commits](#background-commits) and directly by invoking
the [`.commit()`](/docs/reference/modal.Volume#commit)
method on a `modal.Volume` object.

At container creation time the latest state of an attached Volume is mounted. If
the Volume is then subsequently modified by a commit operation in another
running container, that Volume modification won't become available until the
original container does a [`.reload()`](/docs/reference/modal.Volume#reload).

Consider this example which demonstrates the effect of a reload:

```python
import pathlib
import modal

app = modal.App()

volume = modal.Volume.from_name("my-volume")

p = pathlib.Path("/root/foo/bar.txt")


@app.function(volumes={"/root/foo": volume})
def f():
    p.write_text("hello")
    print(f"Created {p=}")
    volume.commit()  # Persist changes
    print(f"Committed {p=}")


@app.function(volumes={"/root/foo": volume})
def g(reload: bool = False):
    if reload:
        volume.reload()  # Fetch latest changes
    if p.exists():
        print(f"{p=} contains '{p.read_text()}'")
    else:
        print(f"{p=} does not exist!")


@app.local_entrypoint()
def main():
    g.remote()  # 1. container for `g` starts
    f.remote()  # 2. container for `f` starts, commits file
    g.remote(reload=False)  # 3. reuses container for `g`, no reload
    g.remote(reload=True)   # 4. reuses container, but reloads to see file.
```

The output for this example is this:

```
p=PosixPath('/root/foo/bar.txt') does not exist!
Created p=PosixPath('/root/foo/bar.txt')
Committed p=PosixPath('/root/foo/bar.txt')
p=PosixPath('/root/foo/bar.txt') does not exist!
p=PosixPath('/root/foo/bar.txt') contains hello
```

This code runs two containers, one for `f` and one for `g`. Only the last
function invocation reads the file created and committed by `f` because it was
configured to reload.

### Background commits

Modal Volumes run background commits:
every few seconds while your Function executes,
the contents of attached Volumes will be committed
without your application code calling `.commit`.
A final snapshot and commit is also automatically performed on container shutdown.

Being able to persist changes to Volumes without changing your application code
is especially useful when [training or fine-tuning models using frameworks](#model-checkpointing).

## Model serving

A single ML model can be served by simply baking it into a `modal.Image` at
build time using [`run_function`](/docs/reference/modal.Image#run_function). But
if you have dozens of models to serve, or otherwise need to decouple image
builds from model storage and serving, use a `modal.Volume`.

Volumes can be used to save a large number of ML models and later serve any one
of them at runtime with great performance. This snippet below shows the
basic structure of the solution.

```python
import modal

app = modal.App()
volume = modal.Volume.from_name("model-store")
model_store_path = "/vol/models"


@app.function(volumes={model_store_path: volume}, gpu="any")
def run_training():
    model = train(...)
    save(model_store_path, model)
    volume.commit()  # Persist changes


@app.function(volumes={model_store_path: volume})
def inference(model_id: str, request):
    try:
        model = load_model(model_store_path, model_id)
    except NotFound:
        volume.reload()  # Fetch latest changes
        model = load_model(model_store_path, model_id)
    return model.run(request)
```

For more details, see our [guide to storing model weights on Modal](/docs/guide/model-weights).

## Model checkpointing

Checkpoints are snapshots of an ML model and can be configured by the callback
functions of ML frameworks. You can use saved checkpoints to restart a training
job from the last saved checkpoint. This is particularly helpful in managing
[preemption](/docs/guide/preemption).

For more, see our [example code for long-running training](/docs/examples/long-training).

### Hugging Face `transformers`

To periodically checkpoint into a `modal.Volume`, just set the `Trainer`'s
[`output_dir`](https://huggingface.co/docs/transformers/main/en/main_classes/trainer#transformers.TrainingArguments.output_dir)
to a directory in the Volume.

```python
import pathlib

volume = modal.Volume.from_name("my-volume")
VOL_MOUNT_PATH = pathlib.Path("/vol")

@app.function(
    gpu="A10G",
    timeout=2 * 60 * 60,  # run for at most two hours
    volumes={VOL_MOUNT_PATH: volume},
)
def finetune():
    from transformers import Seq2SeqTrainer
    ...

    training_args = Seq2SeqTrainingArguments(
        output_dir=str(VOL_MOUNT_PATH / "model"),
        # ... more args here
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_xsum_train,
        eval_dataset=tokenized_xsum_test,
    )
```

## Volume performance

Volumes work best when they contain less than 50,000 files and directories. The
latency to attach or modify a Volume scales linearly with the number of files in
the Volume, and past a few tens of thousands of files the linear component
starts to dominate the fixed overhead.

There is currently a hard limit of 500,000 inodes (files, directories and
symbolic links) per Volume. If you reach this limit, any further attempts to
create new files or directories will error with
[`ENOSPC` (No space left on device)](https://pubs.opengroup.org/onlinepubs/9799919799/).

If you need to work with a large number of files, consider using Volumes v2!
It is currently in beta. See below for more info.

## Filesystem consistency

### Concurrent modification

Concurrent modification from multiple containers is supported, but concurrent
modifications of the same files should be avoided. Last write wins in case of
concurrent modification of the same file — any data the last writer didn't have
when committing changes will be lost!

The number of commits you can run concurrently is limited. If you run too many
concurrent commits each commit will take longer due to contention. If you are
committing small changes, avoid doing more than 5 concurrent commits (the number
of concurrent commits you can make is proportional to the size of the changes
being committed).

As a result, Volumes are typically not a good fit for use cases where you need
to make concurrent modifications to the same file (nor is distributed file
locking supported).

While a reload is in progress the Volume will appear empty to the container that
initiated the reload. That means you cannot read from or write to a Volume in a
container where a reload is ongoing (note that this only applies to the
container where the reload was issued, other containers remain unaffected).

### Busy Volume errors

You can only reload a Volume when there no open files on the Volume. If you have
open files on the Volume the [`.reload()`](/docs/reference/modal.Volume#reload)
operation will fail with "volume busy". The following is a simple example of how
a "volume busy" error can occur:

```python
volume = modal.Volume.from_name("my-volume")


@app.function(volumes={"/vol": volume})
def reload_with_open_files():
    f = open("/vol/data.txt", "r")
    volume.reload()  # Cannot reload when files in the Volume are open.
```

### Can't find file on Volume errors

When accessing files in your Volume, don't forget to pre-pend where your Volume
is mounted in the container.

In the example below, where the Volume has been mounted at `/data`, "hello" is
being written to `/data/xyz.txt`.

```python
import modal

app = modal.App()
vol = modal.Volume.from_name("my-volume")


@app.function(volumes={"/data": vol})
def run():
    with open("/data/xyz.txt", "w") as f:
        f.write("hello")
    vol.commit()
```

If you instead write to `/xyz.txt`, the file will be saved to the local disk of the Modal Function.
When you dump the contents of the Volume, you will not see the `xyz.txt` file.

## Volumes v2 overview

Volumes v2 generally behave just like Volumes v1, and most of the existing APIs
and CLI commands that you are used to will work the same between versions.
Because the file system implementation is completely different, there will be
some significant performance characteristics that can differ from version 1
Volumes. Below is an outline of the key differences you should be aware of.

### Volumes v2 is still in beta

This new file system version is still in beta, and we cannot guarantee that
no data will be lost. We don't recommend using Volumes v2 for any
mission-critical data at this time. You can still reap the benefits of v2 for
data that isn't precious, or that is easy to rebuild, such as log files,
regularly updated training data and model weights, caches, and more.

### Volumes v2 are HIPAA compliant

If you delete the volume, the data is guaranteed to be lost according to HIPAA requirements.

### Volumes v2 is more scaleable

Volumes v2 support more files, higher throughput, and more irregular access
patterns. Commits and reloads are also faster.

Additionally, Volumes v2 supports hard-linking of files, where multiple paths
can point to the same inode.

### In v2, you can store as many files as you want

There is no limit on the number of files in Volumes v2.

By contrast, in Volumes v1, there is a limit on the number of files of 500,000,
and we recommend keeping the count to 50,000 or less.

### In v2, you can write concurrently from hundreds of containers

The file system should not experience any performance degradation as more
containers write to distinct files simultaneously.

By contrast, in Volumes v1, we recommend no more than five writers access the
Volume at once.

Note, however, that concurrent access to a particular _file_ in a Volume still
has last-write-wins semantics in many circumstances. These semantics are
unacceptable for most applications, so any particular file should only be
written to by a single container at a time.

### In v2, random accesses have improved performance

In v1, writes to locations inside a file would sometimes incur substantial
overhead, like a rewrite of the entire file.

In v2, this overhead is removed, and only changes are written.

### In v2, you can commit using `sync`

For Volumes v2, you can trigger a commit from within a Sandbox or modal shell
by running the `sync` command on the mountpoint:

```bash
sync /path/to/mountpoint
```

This is useful when you don't have access to the Python SDK's
[`.commit()`](/docs/reference/modal.Volume#commit) method, such as when running
shell commands in a Sandbox or during an interactive `modal shell` session.

Running `sync` on the mountpoint will flush any pending writes to the kernel
and then persist all data and metadata changes to the Volume's persistent
storage.

For example, to commit changes in a modal shell session:

```bash
% modal shell --volume my-v2-volume
root / → echo "hello" > /mnt/my-v2-volume/test.txt
root / → sync /mnt/my-v2-volume  # Persist changes before exiting
```

Or to commit from within a Sandbox:

```python notest
sb = modal.Sandbox.create(
    volumes={"/data": modal.Volume.from_name("my-v2-volume")},
    app=my_app,
)
sb.exec("bash", "-c", "echo 'hello' > /data/test.txt").wait()

# Persist changes and check for errors
p = sb.exec("sync", "/data")
p.wait()
if p.returncode != 0:
    raise Exception(f"sync failed with exit code {p.returncode}")
```

> ⚠️ This feature is only available for Volumes v2.

### Volumes v2 has a few limits in place

While we work out performance trade-offs and listen to user feedback, we have
put some artificial limits in place.

- Files must be less than one 1 TiB.
- At most 32,768 files can be stored in a single directory.
  Directory depth is unbounded, so the total file count is unbounded.
- Traversing the filesystem can be slower in v2 than in v1, due to demand
  loading of the filesystem tree.

### Upgrading v1 Volumes

Currently, there is no automated tool for upgrading v1 Volumes to v2. We are
planning to implement an automated migration path but for now v1 Volumes need
to be manually migrated by creating a new v2 Volume and either copying files
over from the v1 Volume or writing new files.

To reuse the name of an existing v1 Volume for a new v2 Volume, first stop all
apps that are utilizing the v1 Volume before deleting it. If this is not
feasible, e.g. due to wanting to avoid downtime, use a new name for the v2
Volume.

**Warning:** When deleting an existing Volume, any deployed apps or running
functions utilizing that Volume will cease to function, even if a new Volume is
created with the same name. This is because Volumes are identified with opaque
unique IDs that are resolved at application deployment or start time. A newly
created Volume with the same name as a deleted Volume will have a new Volume ID
and any deployed or running apps will still be referring to the old ID until
these apps are re-deployed or restarted.

In order to create a new volume and copy data over from the old volume, you can
use a tool like `cp` if you intend to copy all the data in one go, or `rsync`
if you want to incrementally copy the data across a longer time span:

```shell
$ modal volume create --version=2 2files2furious
$ modal shell --volume files-and-furious --volume 2files2furious
Welcome to Modal's debug shell!
We've provided a number of utilities for you, like `curl` and `ps`.
# Option 1: use `cp`
root / → cp -rp /mnt/files-and-furious/. /mnt/2files2furious/.
root / → sync /mnt/2files2furious # Ensure changes are persisted before exiting

# Option 2: use `rsync`
root / → apt install -y rsync
root / → rsync -a /mnt/files-and-furious/. /mnt/2files2furious/.
root / → sync /mnt/2files2furious # Ensure changes are persisted before exiting
```

## Further examples

- [Character LoRA fine-tuning](/docs/examples/diffusers_lora_finetune) with model storage on a Volume
- [Protein folding](/docs/examples/chai1) with model weights and output files stored on Volumes
- [Dataset visualization with Datasette](/docs/example/cron_datasette) using a SQLite database on a Volume
# Queues

Modal Queues provide distributed FIFO queues to your Modal Apps.

```python runner:ModalRunner
import modal

app = modal.App()
queue = modal.Queue.from_name("simple-queue", create_if_missing=True)


def producer(x):
    queue.put(x)  # adding a value


@app.function()
def consumer():
    return queue.get()  # retrieving a value


@app.local_entrypoint()
def main(x="some object"):
    # produce and consume tasks from local or remote code
    producer(x)
    print(consumer.remote())
```

This page is a high-level guide to using Modal Queues.
For reference documentation on the `modal.Queue` object, see
[this page](/docs/reference/modal.Queue).
For reference documentation on the `modal queue` CLI command, see
[this page](/docs/reference/cli/queue).

## Modal Queues are Python queues in the cloud

Like [Python `Queue`s](https://docs.python.org/3/library/queue.html),
Modal Queues are multi-producer, multi-consumer first-in-first-out (FIFO) queues.

Queues are particularly useful when you want to handle tasks or process
data asynchronously, or when you need to pass messages between different
components of your distributed system.

Queues are cleared 24 hours after the last `put` operation and are backed by
a replicated in-memory database, so persistence is likely, but not guaranteed.
As such, `Queue`s are best used for communication between active functions and
not relied on for persistent storage.

[Please get in touch](mailto:support@modal.com) if you need durability for Queue objects.

## Queues are partitioned by key

Queues are split into separate FIFO partitions via a string key. By default, one
partition (corresponding to an empty key) is used.

A single `Queue` can contain up to 100,000 partitions, each with up to 5,000
items. Each item can be up to 1 MiB. These limits also apply to the default
partition.

Each partition has an independent TTL, by default 24 hours.
Lower TTLs can be specified by the `partition_ttl` argument in the `put` or
`put_many` methods.

```python
with modal.Queue.ephemeral() as q:
    q.put("some value")  # first in
    q.put(123)

    assert q.get() == "some value"  # first out
    assert q.get() == 123

    q.put(0)
    q.put(1, partition="foo")
    q.put(2, partition="bar")

    # Default and "foo" partition are ignored by the get operation.
    assert q.get(partition="bar") == 2

    # Set custom 10s expiration time on "foo" partition.
    q.put(3, partition="foo", partition_ttl=10)

    # (beta feature) Iterate through items in place (read immutably)
    q.put(1)
    assert [v for v in q.iterate()] == [0, 1]
```

## You can access Modal Queues synchronously or asynchronously, blocking or non-blocking

Queues are synchronous and blocking by default. Consumers will block and wait
on an empty Queue and producers will block and wait on a full Queue,
both with an `Optional`, configurable `timeout`. If the `timeout` is `None`,
they will wait indefinitely. If a `timeout` is provided, `get` methods will raise
[`queue.Empty`](https://docs.python.org/3/library/queue.html#queue.Empty)
exceptions and `put` methods will raise
[`queue.Full`](https://docs.python.org/3/library/queue.html#queue.Full)
exceptions, both from the Python standard library.

The `get` and `put` methods can be made non-blocking by setting the `block` argument to `False`.
They raise `queue` exceptions without waiting on the `timeout`.

Queues are stored in the cloud, so all interactions require communication over the network.
This adds some extra latency to calls, apart from the `timeout`, on the order of tens of milliseconds.
To avoid this latency impacting application latency, you can asynchronously interact with Queues
by adding the `.aio` function suffix to access methods.

```python notest
@app.local_entrypoint()
async def main(value=None):
    await my_queue.put.aio(value or 200)
    assert await my_queue.get.aio() == value
```

See the guide to [asynchronous functions](/docs/guide/async) for more
information.

## Modal Queues are not _exactly_ Python Queues

Python Queues can have values of any type.

Modal Queues can store Python objects of any serializable type.

Objects are serialized using [`cloudpickle`](https://github.com/cloudpipe/cloudpickle),
so precise support is inherited from that library. `cloudpickle` can serialize a surprising variety of objects,
like `lambda` functions or even Python modules, but it can't serialize a few things that don't
really make sense to serialize, like live system resources (sockets, writable file descriptors).

Note that you will need to have the library defining the type installed in the environment
where you retrieve the object so that it can be deserialized.

```python runner:ModalRunner
import modal

app = modal.App()


@app.function(image=modal.Image.debian_slim().pip_install("numpy"))
def fill(q: modal.Queue):
    import numpy

    q.put(modal)
    q.put(q)  # don't try this at home!
    q.put(numpy)


@app.local_entrypoint()
def main():
    with modal.Queue.ephemeral() as q:
        fill.remote(q)
        print(q.get().Queue)
        print(q.get())
        # print(q.get())  # DeserializationError, if no numpy locally
```
# Dicts

Modal Dicts provide distributed key-value storage to your Modal Apps.

```python runner:ModalRunner
import modal

app = modal.App()
kv = modal.Dict.from_name("kv", create_if_missing=True)


@app.local_entrypoint()
def main(key="cloud", value="dictionary", put=True):
    if put:
        kv[key] = value
    print(f"{key}: {kv[key]}")
```

This page is a high-level guide to using Modal Dicts.
For reference documentation on the `modal.Dict` object, see
[this page](/docs/reference/modal.Dict).
For reference documentation on the `modal dict` CLI command, see
[this page](/docs/reference/cli/dict).

## Modal Dicts are Python dicts in the cloud

Dicts provide distributed key-value storage to your Modal Apps.
Much like a standard Python dictionary, a Dict lets you store and retrieve
values using keys. However, unlike a regular dictionary, a Dict in Modal is
accessible from anywhere, concurrently and in parallel.

```python
# create a remote Dict
dictionary = modal.Dict.from_name("my-dict", create_if_missing=True)


dictionary["key"] = "value"  # set a value from anywhere
value = dictionary["key"]    # get a value from anywhere
```

Dicts are persisted, which means that the data in the dictionary is
stored and can be retrieved even after the application is redeployed.

## You can access Modal Dicts asynchronously

Modal Dicts live in the cloud, which means reads and writes
against them go over the network. That has some unavoidable latency overhead,
relative to just reading from memory, of a few dozen ms.
Reads from Dicts via `["key"]`-style indexing are synchronous,
which means that latency is often directly felt by the application.

But like all Modal objects, you can also interact with Dicts asynchronously
by putting the `.aio` suffix on methods -- in this case, `put` and `get`,
which are synonyms for bracket-based indexing.
Just add the `async` keyword to your `local_entrypoint`s or remote Functions
and `await` the method calls.

```python runner:ModalRunner
import modal

app = modal.App()
dictionary = modal.Dict.from_name("async-dict", create_if_missing=True)


@app.local_entrypoint()
async def main():
    await dictionary.put.aio("key", "value")  # setting a value asynchronously
    assert await dictionary.get.aio("key")   # getting a value asynchronously
```

See the guide to [asynchronous functions](/docs/guide/async) for more
information.

## Modal Dicts are not _exactly_ Python dicts

Python dicts can have keys of any hashable type and values of any type.

You can store Python objects of any serializable type within Dicts as keys or values.

Objects are serialized using [`cloudpickle`](https://github.com/cloudpipe/cloudpickle),
so precise support is inherited from that library. `cloudpickle` can serialize a surprising variety of objects,
like `lambda` functions or even Python modules, but it can't serialize a few things that don't
really make sense to serialize, like live system resources (sockets, writable file descriptors).

Note that you will need to have the library defining the type installed in the environment
where you retrieve the object so that it can be deserialized.

```python runner:ModalRunner
import modal

app = modal.App()
dictionary = modal.Dict.from_name("funky-dict", create_if_missing=True)


@app.function(image=modal.Image.debian_slim().pip_install("numpy"))
def fill():
    import numpy

    dictionary["numpy"] = numpy
    dictionary["modal"] = modal
    dictionary[dictionary] = dictionary  # don't try this at home!


@app.local_entrypoint()
def main():
    fill.remote()
    print(dictionary["modal"])
    print(dictionary[dictionary]["modal"].Dict)
    # print(dictionary["numpy"])  # DeserializationError, if no numpy locally
```

Unlike with normal Python dictionaries, updates to mutable value types will not
be reflected in other containers unless the updated object is explicitly put
back into the Dict. As a consequence, patterns like chained updates
(`my_dict["outer_key"]["inner_key"] = value`) cannot be used the same way as
they would with a local dictionary.

Currently, the per-object size limit is 100 MiB and the maximum number of entries
per update is 10,000. It's recommended to use Dicts for smaller objects (under 5 MiB).
Each object in the Dict will expire after 7 days of inactivity (no reads or writes).

Dicts also provide a locking primitive. See
[this blog post](/blog/cache-dict-launch) for details.
# Environment variables

The Modal runtime sets several environment variables during initialization. The
keys for these environment variables are reserved and cannot be overridden by
your Function or Sandbox configuration.

These variables provide information about the container's runtime
environment.

## Container runtime environment variables

The following variables are present in every Modal container:

- **`MODAL_CLOUD_PROVIDER`** — Modal executes containers across a number of cloud
  providers ([AWS](https://aws.amazon.com/), [GCP](https://cloud.google.com/),
  [OCI](https://www.oracle.com/cloud/)). This variable specifies which cloud
  provider the Modal container is running within.
- **`MODAL_IMAGE_ID`** — The ID of the
  [`modal.Image`](/docs/reference/modal.Image) used by the Modal container.
- **`MODAL_REGION`** — This will correspond to a geographic area identifier from
  the cloud provider associated with the Modal container (see above). For AWS, the
  identifier is a "region". For GCP it is a "zone", and for OCI it is an
  "availability domain". Example values are `us-east-1` (AWS), `us-central1`
  (GCP), `us-ashburn-1` (OCI). See the [full list here](/docs/guide/region-selection#region-options).
- **`MODAL_TASK_ID`** — The ID of the container running the Modal Function or Sandbox.

## Function runtime environment variables

The following variables are present in containers running Modal Functions:

- **`MODAL_ENVIRONMENT`** — The name of the
  [Modal Environment](/docs/guide/environments) the container is running within.
- **`MODAL_IS_REMOTE`** - Set to '1' to indicate that Modal Function code is running in
  a remote container.
- **`MODAL_IDENTITY_TOKEN`** — An [OIDC token](/docs/guide/oidc-integration)
  encoding the identity of the Modal Function.

## Sandbox environment variables

The following variables are present within [`modal.Sandbox`](/docs/reference/modal.Sandbox) instances.

- **`MODAL_SANDBOX_ID`** — The ID of the Sandbox.

## Container image environment variables

The container image layers used by a `modal.Image` may set
environment variables. These variables will be present within your container's runtime
environment. For example, the
[`debian_slim`](/docs/reference/modal.Image#debian_slim) image sets the
`GPG_KEY` variable.

To override image variables or set new ones, use the
[`.env`](https://modal.com/docs/reference/modal.Image#env) method provided by
`modal.Image`.
# Cold start performance

Modal Functions are run in [containers](/docs/guide/images).

If a container is already ready to run your Function, it will be reused.

If not, Modal spins up a new container.
This is known as a _cold start_,
and it is often associated with higher latency.

There are two sources of increased latency during cold starts:

1. inputs may **spend more time waiting** in a queue for a container
   to become ready or "warm".
2. when an input is handled by the container that just started,
   there may be **extra work that only needs to be done on the first invocation**
   ("initialization").

This guide presents techniques and Modal features for reducing the impact of both queueing
and initialization on observed latencies.

If you are invoking Functions with no warm containers
or if you otherwise see inputs spending too much time in the "pending" state,
you should
[target queueing time for optimization](#reduce-time-spent-queueing-for-warm-containers).

If you see some Function invocations taking much longer than others,
and those invocations are the first handled by a new container,
you should
[target initialization for optimization](#reduce-latency-from-initialization).

## Reduce time spent queueing for warm containers

New containers are booted when there are not enough other warm containers to
to handle the current number of inputs.

For example, the first time you send an input to a Function,
there are zero warm containers and there is one input,
so a single container must be booted up.
The total latency for the input will include
the time it takes to boot a container.

If you send another input right after the first one finishes,
there will be one warm container and one pending input,
and no new container will be booted.

Generalizing, there are two factors that affect the time inputs spend queueing:
the time it takes for a container to boot and become warm (which we solve by booting faster)
and the time until a warm container is available to handle an input (which we solve by having more warm containers).

### Warm up containers faster

The time taken for a container to become warm
and ready for inputs can range from seconds to minutes.

Modal's custom container stack has been heavily optimized to reduce this time.
Containers boot in about one second.

But before a container is considered warm and ready to handle inputs,
we need to execute any logic in your code's global scope (such as imports)
or in any
[`modal.enter` methods](/docs/guide/lifecycle-functions).
So if your boots are slow, these are the first places to work on optimization.

For example, you might be downloading a large model from a model server
during the boot process.
You can instead
[download the model ahead of time](/docs/guide/model-weights),
so that it only needs to be downloaded once.

For models in the tens of gigabytes,
this can reduce boot times from minutes to seconds.

### Run more warm containers

It is not always possible to speed up boots sufficiently.
For example, seconds of added latency to load a model may not
be acceptable in an interactive setting.

In this case, the only option is to have more warm containers running.
This increases the chance that an input will be handled by a warm container,
for example one that finishes an input while another container is booting.

Modal currently exposes [three parameters](/docs/guide/scale) that control how
many containers will be warm: `scaledown_window`, `min_containers`,
and `buffer_containers`.

All of these strategies can increase the resources consumed by your Function
and so introduce a trade-off between cold start latencies and cost.

#### Keep containers warm for longer with `scaledown_window`

Modal containers will remain idle for a short period before shutting down. By
default, the maximum idle time is 60 seconds. You can configure this by setting
the `scaledown_window` on the [`@function`](/docs/reference/modal.App#function)
decorator. The value is measured in seconds, and it can be set anywhere between
two seconds and twenty minutes.

```python
import modal

app = modal.App()

@app.function(scaledown_window=300)
def my_idle_greeting():
    return {"hello": "world"}
```

Increasing the `scaledown_window` reduces the chance that subsequent requests
will require a cold start, although you will be billed for any resources used
while the container is idle (e.g., GPU reservation or residual memory
occupancy). Note that containers will not necessarily remain alive for the
entire window, as the autoscaler will scale down more aggressively when the
Function is substantially over-provisioned.

#### Overprovision resources with `min_containers` and `buffer_containers`

Keeping already warm containers around longer doesn't help if there are no warm
containers to begin with, as when Functions scale from zero.

To keep some containers warm and running at all times, set the `min_containers`
value on the [`@function`](/docs/reference/modal.App#function) decorator. This
puts a floor on the the number of containers so that the Function doesn't scale
to zero. Modal will still scale up and spin down more containers as the
demand for your Function fluctuates above the `min_containers` value, as usual.

While `min_containers` overprovisions containers while the Function is idle,
`buffer_containers` provisions extra containers while the Function is active.
This "buffer" of extra containers will be idle and ready to handle inputs if
the rate of requests increases. This parameter is particularly useful for
bursty request patterns, where the arrival of one input predicts the arrival of more inputs,
like when a new user or client starts hitting the Function.

```python
import modal

app = modal.App(image=modal.Image.debian_slim().pip_install("fastapi"))

@app.function(min_containers=3, buffer_containers=3)
def my_warm_greeting():
    return "Hello, world!"
```

## Reduce latency from initialization

Some work is done the first time that a function is invoked
but can be used on every subsequent invocation.
This is
[_amortized work_](https://www.cs.cornell.edu/courses/cs312/2006sp/lectures/lec18.html)
done at initialization.

For example, you may be using a large pre-trained model
whose weights need to be loaded from disk to memory the first time it is used.

This results in longer latencies for the first invocation of a warm container,
which shows up in the application as occasional slow calls: high tail latency or elevated p9Xs.

### Move initialization work out of the first invocation

Some work done on the first invocation can be moved up and completed ahead of time.

Any work that can be saved to disk, like
[downloading model weights](/docs/guide/model-weights),
should be done as early as possible. The results can be included in the
[container's Image](/docs/guide/images)
or saved to a
[Modal Volume](/docs/guide/volumes).

Some work is tricky to serialize, like spinning up a network connection or an inference server.
If you can move this initialization logic out of the function body and into the global scope or a
[container `enter` method](https://modal.com/docs/guide/lifecycle-functions#enter),
you can move this work into the warm up period.
Containers will not be considered warm until all `enter` methods have completed,
so no inputs will be routed to containers that have yet to complete this initialization.

For more on how to use `enter` with machine learning model weights, see
[this guide](/docs/guide/model-weights).

Note that `enter` doesn't get rid of the latency --
it just moves the latency to the warm up period,
where it can be handled by
[running more warm containers](#run-more-warm-containers).

### Share initialization work across cold starts with memory snapshots

Cold starts can also be made faster by using memory snapshots.

Invocations of a Function after the first
are faster in part because the memory is already populated
with values that otherwise need to be computed or read from disk,
like the contents of imported libraries.

Memory snapshotting captures the state of a container's memory
at user-controlled points after it has been warmed up
and reuses that state in future boots, which can substantially
reduce cold start latency penalties and warm up period duration.

Refer to the [memory snapshot](/docs/guide/memory-snapshot)
guide for details.

### Optimize initialization code

Sometimes, there is nothing to be done but to speed this work up.

Here, we share specific patterns that show up in optimizing initialization
in Modal Functions.

#### Load multiple large files concurrently

Often Modal applications need to read large files into memory (eg. model
weights) before they can process inputs. Where feasible these large file
reads should happen concurrently and not sequentially. Concurrent IO takes
full advantage of our platform's high disk and network bandwidth
to reduce latency.

One common example of slow sequential IO is loading multiple independent
Huggingface `transformers` models in series.

```python notest
from transformers import CLIPProcessor, CLIPModel, BlipProcessor, BlipForConditionalGeneration
model_a = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor_a = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
model_b = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-large")
processor_b = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-large")
```

The above snippet does four `.from_pretrained` loads sequentially.
None of the components depend on another being already loaded in memory, so they
can be loaded concurrently instead.

They could instead be loaded concurrently using a function like this:

```python notest
from concurrent.futures import ThreadPoolExecutor, as_completed
from transformers import CLIPProcessor, CLIPModel, BlipProcessor, BlipForConditionalGeneration

def load_models_concurrently(load_functions_map: dict) -> dict:
    model_id_to_model = {}
    with ThreadPoolExecutor(max_workers=len(load_functions_map)) as executor:
        future_to_model_id = {
            executor.submit(load_fn): model_id
            for model_id, load_fn in load_functions_map.items()
        }
        for future in as_completed(future_to_model_id.keys()):
            model_id_to_model[future_to_model_id[future]] = future.result()
    return model_id_to_model

components = load_models_concurrently({
    "clip_model": lambda: CLIPModel.from_pretrained("openai/clip-vit-base-patch32"),
    "clip_processor": lambda: CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32"),
    "blip_model": lambda: BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-large"),
    "blip_processor": lambda: BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-large")
})
```

If performing concurrent IO on large file reads does _not_ speed up your cold
starts, it's possible that some part of your function's code is holding the
Python [GIL](https://wiki.python.org/moin/GlobalInterpreterLock) and reducing
the efficacy of the multi-threaded executor.
# Memory Snapshot

Modal can save the state of your Function's memory right after initialization and restore it directly later, skipping initialization work.

These "memory snapshots" can dramatically improve cold start performance for Modal Functions.

During initialization, your code might read many files from the file system, which is quite expensive.
For example, the `torch` package is [hundreds of MiB](https://pypi.org/project/torch/#files) and requires over 20,000 file operations to load!
Such Functions typically start several times faster with memory snapshots enabled.

The memory snapshot feature has two variants. GPU memory snapshots (alpha) provide full GPU access before the snapshot is taken, while CPU memory snapshots do not.

## CPU Memory Snapshot

CPU memory snapshots capture the state of a container and save it to disk. This saved snapshot can then be used to quickly restore new containers to the exact same state.

### Basic usage

You can enable memory snapshots for your Function with the `enable_memory_snapshot=True` parameter:

```python
@app.function(enable_memory_snapshot=True)
def my_func():
    print("hello")
```

Then deploy the App with `modal deploy`. Memory snapshots are created only for deployed Apps.

When using classes decorated with [`@cls`](/docs/guide/lifecycle-functions), [`@modal.enter()`](/docs/reference/modal.enter) hooks are not included in the snapshot by default. Add `snap=True` to include them:

```python
@app.cls(enable_memory_snapshot=True)
class MyCls:
    @modal.enter(snap=True)
    def load(self):
        ...
```

Any code executed in global scope, such as top-level imports, will also be captured by the memory snapshot.

### CPU memory snapshots for GPU workloads

CPU memory snapshots don't support direct GPU memory capture, but GPU Functions can still benefit
from memory snapshots through a two-stage initialization process. This involves refactoring
your initialization code to run across two separate `@modal.enter` functions: one that runs before
creating the snapshot (`snap=True`), and one that runs after restoring from the
snapshot (`snap=False`). Load model weights onto CPU memory in the `snap=True`
method, and then move the weights onto GPU memory in the `snap=False` method.
Here's an example using the `sentence-transformers` package:

```python
import modal

image = modal.Image.debian_slim().pip_install("sentence-transformers")
app = modal.App("sentence-transformers", image=image)

with image.imports():
    from sentence_transformers import SentenceTransformer

model_vol = modal.Volume.from_name("sentence-transformers-models", create_if_missing=True)

@app.cls(gpu="a10g", volumes={"/models": model_vol}, enable_memory_snapshot=True)
class Embedder:
    model_id = "BAAI/bge-small-en-v1.5"

    @modal.enter(snap=True)
    def load(self):
        # Create a memory snapshot with the model loaded in CPU memory.
        self.model = SentenceTransformer(f"/models/{self.model_id}", device="cpu")

    @modal.enter(snap=False)
    def setup(self):
        self.model.to("cuda")  # Move the model to a GPU!

    @modal.method()
    def run(self, sentences:list[str]):
        embeddings = self.model.encode(sentences, normalize_embeddings=True)
        print(embeddings)

@app.local_entrypoint()
def main():
    Embedder().run.remote(sentences=["what is the meaning of life?"])

if __name__ == "__main__":
    cls = modal.Cls.from_name("sentence-transformers", "Embedder")
    cls().run.remote(sentences=["what is the meaning of life?"])
```

Even without GPU snapshotting, this workaround reduces the time it takes for `Embedder.run`
to startup by about 3x, from ~6 seconds down to just ~2 seconds.

### GPU availability during the memory snapshot phase

If you are using the GPU memory snapshot feature (`enable_gpu_snapshot`), then
GPUs are available within `@enter(snap=True)`.

If you are using memory snapshots _without_ `enable_gpu_snapshot`, then it's important
to note that GPUs will not be available within the `@enter(snap=True)` method.

```python
import modal
app = modal.App(image=modal.Image.debian_slim().pip_install("torch"))
@app.cls(enable_memory_snapshot=True, gpu="A10")
class GPUAvailability:
    @modal.enter(snap=True)
    def no_gpus_available_during_snapshots(self):
        import torch
        print(f"GPUs available: {torch.cuda.is_available()}")  # False

    @modal.enter(snap=False)
    def gpus_available_following_restore(self):
        import torch
        print(f"GPUs available: {torch.cuda.is_available()}")  # True

    @modal.method()
    def demo(self):
        print(f"GPUs available: {torch.cuda.is_available()}") # True
```

### Known limitations

The `torch.cuda` module has multiple functions which, if called during
snapshotting, will initialize CUDA as having zero GPU devices. Such functions
include `torch.cuda.is_available` and `torch.cuda.get_device_capability`.
If you're using a framework that calls these methods during its import phase,
it may not be compatible with memory snapshots. The problem can manifest as
confusing "cuda not available" or "no CUDA-capable device is detected" errors.

We have found that importing PyTorch twice solves the problem in some cases:

```python

@app.cls(enable_memory_snapshot=True, gpu="A10")
class GPUAvailability:
    @modal.enter(snap=True)
    def pre_snap(self):
        import torch
        ...
    @modal.enter(snap=False)
    def post_snap(self):
        import torch   # re-import to re-init GPU availability state
        ...
```

In particular, `xformers` is known to call `torch.cuda.get_device_capability` on
import, so if it is imported during snapshotting it can unhelpfully initialize
CUDA with zero GPUs. The
[workaround](https://github.com/facebookresearch/xformers/issues/1030) for this
is to set the `XFORMERS_ENABLE_TRITON` environment variable to `1` in your `modal.Image`.

```python
image = modal.Image.debian_slim().pip_install("xformers>=0.28")  # for instance
image = image.env({"XFORMERS_ENABLE_TRITON": "1"})
```

## GPU Memory Snapshot

With our experimental GPU memory snapshot feature, we are able to capture the entire GPU state too.
This makes for simpler initialization logic and even faster cold starts.

Pass the additional option `experimental_options={"enable_gpu_snapshot": True}` to your Function or class
to enable GPU snapshotting. These functions have full GPU and CUDA access.

```python
@app.function(
    gpu="a10",
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
def my_gpu_func():
    import torch
    print(f"GPUs available: {torch.cuda.is_available()}")  # True
```

Here's what the above `SentenceTransformer` example looks like with GPU memory snapshot enabled:

```python notest
@app.cls(
    gpu="a10g",
    volumes={"/models": model_vol},
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True}
)
class Embedder:
    model_id = "BAAI/bge-small-en-v1.5"

    @modal.enter(snap=True)
    def load(self):
        # Create a memory snapshot with the model loaded in GPU memory.
        self.model = SentenceTransformer(f"/models/{self.model_id}", device="cuda")
```

To achieve even faster cold starts, we recommend warming up your model by running a few forward passes on sample data
in the `@enter(snap=True)` method.

Refer to the code sample [here](/docs/examples/gpu_snapshot) for a more complete example. Our
[blog post](/blog/gpu-mem-snapshots) also provides more useful details.

### Known limitations

GPU memory snapshots are in _alpha_.
[We've seen](/blog/gpu-mem-snapshots) that they can massively reduce cold boot time
but we are still exploring their limitations. Try it for yourself and let us know how it goes!

#### Compatibility with `torch.compile`

If `torch.compile` is called (either directly or indirectly) during the `@modal.enter(snap=True)` method, creating the snapshot will fail for some models. In some of these cases, setting the [environment variable](/docs/guide/environment_variables) `TORCHINDUCTOR_COMPILE_THREADS` to `1` will solve the issue.

## Memory Snapshot FAQ

### When are snapshots updated?

Redeploying your Function with new configuration (e.g. a [new GPU type](/docs/guide/gpu))
or new code will cause previous snapshots to become obsolete.
Subsequent invocations to the new Function version will automatically create new snapshots with the new configuration and code.

Changes to [Modal Volumes](/docs/guide/volumes) do not cause snapshots to update.
Deleting files in a Volume used during restore will cause restore failures.

### I haven't changed my Function. Why do I still see snapshots being created sometimes?

Modal recaptures snapshots to keep up with the platform's latest runtime and security changes.

Additionally, you may observe your Function being memory
snapshot multiple times during its first few invocations. This happens because
memory snapshots are specific to the underlying worker type that created them (e.g. low-level processor details),
and Modal Functions run across a handful of worker types.

Snapshots may add a small amount of latency to Function initialization.

CPU-only Functions need around 6 snapshots for full coverage, and Functions targeting a specific
GPU (e.g. A100) need 2-3.

### How do snapshots handle randomness?

If your application depends on uniqueness of state, you must evaluate your
Function code and verify that it is resilient to snapshotting operations. For
example, if a variable is randomly initialized and snapshotted, that variable
will be identical after every restore, possibly breaking uniqueness expectations
of the proceeding Function code.
# High-performance LLM inference

This high-level guide documents the key techniques used to achieve high performance
when running LLM inference on Modal.

Open weights models and open source inference engines have
closed much of the gap with proprietary models and proprietary engines
and continue to improve as they attract work from a broad community.
It is now and will increasingly be economical to run many generative AI applications in-house,
rather than relying on external providers.

Achieving competitive performance and cost is not instantaneous, however.
It requires some thought and tuning.
And LLM inference is in many ways quite different to the web serving and database workloads
that engineers are used to deploying and optimizing.

This guide collects techniques we have seen work in production inference deployments.
We include code samples so that you can try high-performance LLM inference for yourself.

We split the guide by the key performance criterion that matters for the workload:

- **[throughput](#achieving-high-throughput-llm-inference-tps)**,
  for large "jobs" made of many parallel requests that are only finished when they all finish,
- **[latency](#minimizing-llm-inference-latency-ttfttpotttlt)**,
  for serving each individual request as fast as possible, usually on human-interactive timescales,
- **[cold start time](#high-performance-llm-inference-for-bursty-workloads-cold-start-time)**,
  for bursty workloads that mix latency- and throughput-sensitive components.

This high-level guide and the attendant code samples are intended to kick-start
your own process of inference deployment and performance optimization.
You can find [baseline benchmarks](https://modal.com/llm-almanac/advisor)
and [benchmarking recommendations](https://modal.com/llm-almanac/how-to-benchmark)
in our [LLM Engineer's Almanac](https://modal.com/llm-almanac).

If you just want to get started running a basic LLM server on Modal, see
[this example](https://modal.com/docs/examples/llm_inference).

## Achieving high throughput LLM inference (TPS)

The quintessential "high throughput" LLM inference workload is a database backfill:
on a trigger, a large number (100s or more) of rows need to be processed,
e.g. to produce a sentiment score as part of an analytics pipeline
or to produce a generation that will be scored as part of offline evals.
No person or system is waiting on the result from any particular row.

Performance is defined by _throughput_, the rate at which tasks are completed,
which translates to end-to-end latency for the entire job.
For most deployments, this in turn directly determines cost.
It is measured in tokens per second (TPS).

Many, but not all, high throughput LLM inference applications have large contexts and small outputs,
which means they are dominated by prefill/prompt processing time, rather than decode/token generation time.
Combined with batching that increases
[arithmetic intensity](https://modal.com/gpu-glossary/perf/arithmetic-intensity),
throughput-oriented LLM inference jobs are generally
[compute-bound](https://modal.com/gpu-glossary/perf/compute-bound).

In general, high throughput is easier to achieve than low latency.
GPUs are inherently [designed for maximum throughput](https://modal.com/gpu-glossary/perf/latency-hiding).
Additionally, LLM training is a throughput-sensitive workload, so good kernels
are typically made available open source earlier.

For instance, the [Flash Attention 4 kernel](/blog/reverse-engineer-flash-attention-4)
that extends the Flash Attention kernel series to [Blackwell GPUs](https://modal.com/blog/introducing-b200-h200)
is, at time of writing months after its initial release,
primarily suitable for throughput-sensitive applications -- but watch this space!

For related reasons, we don't recommend using 4bit floating point (FP4) for these jobs.
FP4 is only supported in [Blackwell or later GPUs](https://modal.com/gpu-glossary/device-software/compute-capability).
Instead, we recommend the more mature 8bit floating point (FP8),
supported in Hopper or later GPUs (one generation back).

On Modal, the [rates](/pricing) for 16bit FLOP/$ are roughly the same across
A100s, H100s, and B200s -- newer GPUs run faster but cost more to match.
So peak throughput per _dollar_ per replica is roughly the same,
even though throughput per _second_ per replica is lower.

But older GPUs running at lower rates offer a few advantages:

- any time spent [underutilizing the GPUs](/blog/gpu-utilization-guide) is less expensive
- GPUs a generation or two back are generally available in larger quantities from hyperscalers

Throughput-oriented jobs don't necessarily benefit from scaling up each replica to more GPUs.
The aggregate throughput is the same as more replicas with fewer GPUs,
but fewer GPUs means reduced communication overhead and
reduced complexity, especially for single GPU-per-replica deployments.
Importantly, you must be able to fit a large enough batch of sequences
into the [GPU RAM](https://modal.com/gpu-glossary/device-hardware/gpu-ram)
that you are compute-bound, or else efficiency will decrease.

We recommend the [vLLM](https://vllm.ai/) inference server for this use case.
It is better able to schedule a mix of prefill and decode work,
which leads to higher throughput.

### High throughput LLM inference on Modal

The lack of latency constraints opens up a large number
of architectural choices for high throughput LLM inference.

For instance, values can be retrieved from an external datastore
or a [Modal Volume](/docs/guide/volumes)
based on identifiers or other information in the datastore.
This is particularly useful for
[cronjob deployments on Modal](/docs/guide/cron).
Results can then be placed back in that datastore.

Modal provides primitives for building a
[job queue](/docs/guide/job-queue)
that can scale to millions of pending inputs
and jobs that last up to a week.
In this case, the underlying LLM inference is provided by a
[Modal Cls](/docs/guide/lifecycle-functions)
invoked via
[`.spawn`](https://modal.com/docs/guide/job-queue).
Each call gets a string
[`modal.FunctionCall` identifier](/docs/reference/modal.FunctionCall)
that can be used to query the result for up to a week.

The primary scaling limit from Modal in this case is the rate at which these calls can be queued.
If the inference system can complete more than 400 tasks per second,
we recommend batching multiple tasks into a single Function input until peak throughput
in tasks per second is serviced by 400 inputs per second.

See [this code sample](https://modal.com/docs/examples/vllm_throughput)
for a system that implements these recommendatons and
achieves maximal per-replica throughput.

## Minimizing LLM inference latency (TTFT/TPOT/TTLT)

The quintessential "low latency" LLM inference workload is a chatbot:
each request represents a waiting user, and users operate at the scale of a few hundred milliseconds.
Generating a token of usefully intelligent text often also takes on the order of milliseconds,
and users want many tokens in responses, so latency budgets are tight.

Performance is defined by _latency_, the time a given task spends waiting.
It is measured in time-to-first-token (TTFT) and time-per-output-token (TPOT)
or in time-to-last-token (TTLT),
depending on to what degree the application supports streaming responses.
For streaming applications, like most chatbots, TTFT matters most.

To whatever degree the application does support streaming, it is strongly recommended
to improve perceived latency by users.
Contemporary Transformer language models are sequential and so generate their responses
serially, leading to long gaps between the creation of the first token in a response and the last.

These long decode or token generation phases demand quite different performance
from hardware than long prefills do.
They are typically [memory-bound](https://modal.com/gpu-glossary/perf/memory-bound)
and so benefit from techniques that reduce the amount of memory loaded per token into the
[Streaming Multiprocessors](https://modal.com/gpu-glossary/device-hardware/streaming-multiprocessor)
or increase the amount of available
[memory bandwidth](https://modal.com/gpu-glossary/perf/memory-bandwidth).

Several techniques can reduce the amount of memory loaded per token:

- smaller and more aggressively [quantized](https://quant.exposed) models require less memory
- [speculative decoding](https://huggingface.co/docs/text-generation-inference/en/conceptual/speculation)
  generates multiple tokens at once via draft models

For memory-bound workloads, quantizing a model to a format not natively supported by the hardware
can still sometimes lead to gains.
The reduced demand on memory bandwidth cuts memory latency and there is generally sufficient unused
[arithmetic bandwidth](https://modal.com/gpu-glossary/perf/arithmetic-bandwidth)
to perform extra numerical conversions.

There are a wide variety of speculative decoding techniques, ranging from simple n-gram speculation
to stacks of models drafting tokens for each other in sequence.
We have generally found that the [EAGLE-3 method](https://arxiv.org/abs/2503.01840)
provides the best performance improvement for the least overhead --
computationally and operationally.
Generic draft models are available on Hugging Face,
but we have also seen major improvements from custom draft models
trained on sample production data using tools like
[SpecForge](https://lmsys.org/blog/2025-07-25-spec-forge/).

Additionally, using multiple GPUs to generate a single token increases the aggregate memory bandwidth,
at the cost of some extra communication.
Critically, multiple accelerators need to be used to load model weights in parallel,
or latency will not be reduced.
That means the usual form of parallelism used to reduce latency is _tensor parallelism_,
which splits up individual matrix multiplications across GPUs,
rather than _pipeline parallelism_,
which splits the entire model across GPUs.

There are few models below 70B parameters that work well in 4bit floating point
(with exceptions like [GPT-OSS](https://modal.com/docs/examples/gpt_oss_inference)).
Additionally, at time of writing in early 2026, there are not high-quality open source
Blackwell-optimized kernels for latency-sensitive LLM inference.
Therefore, we generally recommend FP8-quantized models on H100s or H200s.

Finally, we recommend the [SGLang](https://docs.sglang.io/)
inference engine for these workloads.
SGLang generally exhibits lower host overhead --
time when the GPU idles waiting on the CPU --
for decode-heavy workloads, especially for smaller models.
You can read more about host overhead and its solutions in
[this blog post](/blog/host-overhead-inference-efficiency).

### Low latency LLM inference on Modal

For latency budgets in the few hundreds of milliseconds,
network latencies and proxy/load-balancing overhead matter --
communicating with clients across an ocean takes dozens of milliseconds,
due to speed-of-light constraints.

Modal offers ultra-low-latency, regionalized web server deployment with
`modal.experimental.http_server`
to reduce network overhead below 100ms.
Please contact us if you are interested in running production LLM inference
with the experimental `http_server`.

You can find an example demonstrating all the pieces of
low latency LLM inference on Modal together
[here](https://modal.com/docs/examples/sglang_low_latency).

## High performance LLM inference for bursty workloads (cold start time)

The final major class of workloads sits between pure throughput and pure latency.
The quintessential application is a "workflow" where LLM inference is one workflow step,
and the workflow is sometimes run interactively by a human and at other times run asynchronously in bulk.

For these applications, the primary concern is handling the high
[peak-to-average load ratio](https://brooker.co.za/blog/2023/03/23/economics.html).
For instance, a pipeline might serve zero requests per second most of the time,
then ten for a bit, then one hundred, then back down to zero.
Statically provisioning enough resources to handle one hundred requests is clearly wasteful,
but spinning up new resources on demand incurs latency.

The key performance criterion, then, is
[_cold start time_](/docs/guide/cold-start):
how long does it take for a new replica to spin up and start handling requests.
On a typical cloud deployment, that includes instance requisition, machine boot, and container setup.
We've written about the resource allocation challenges [here](/blog/gpu-utilization-guide).

Approaches based on requesting resources from clouds directly take minutes to tens of minutes.
Modal has been designed from the kernel up to provide sub-second latencies
all the way through to container start.
From there, the primary performance concern is speeding up server startup.

- **Use small models and quantize aggressively**.
  Models can be loaded from a [Modal Volume](/docs/guide/volumes)
  at a rate of 1-2 GB/s. That means you're incurring nearly a second of cold start latency
  per gigabyte of model weights. More exotic compression formats, like integer quantization
  or even ternary quantization, are particularly helpful here, even when they don't improve
  latency during inference.

- **Skip compilation steps**.
  Optimizations like CUDA Graph capture, JIT-compiled kernels, and Torch compilation
  are great for improving latency and throughput but they are generally quite tricky to cache
  and cache hits sometimes take nearly as long as cache misses.
  That often means a large latency penalty from compilation on each boot,
  and latencies can easily range into the tens of seconds or even tens of minutes.

- **Restore from snapshots**.
  In some cases, startup-time work like JIT compilation is unavoidable.
  For these workloads, Modal provides
  [memory snapshots](/docs/guide/memory-snapshot):
  the full in-memory state of a container just before it is ready to
  handle requests is serialized to disk and future container starts
  only need to deserialize this back into memory.
  Modal includes support for
  [GPU memory snapshots](/blog/gpu-mem-snapshots)
  so that GPU-accelerated LLM inference servers can be snapshot as well.
  Memory snapshotting is powerful
  ([we've observed 10x reductions in cold start time](/blog/gpu-mem-snapshots)),
  but it requires some code modification, described below.

Which optimizations discussed above apply
depend on the balance of the workload between low latency and high throughput.
But a few general statements can be made.
For instance, speculative decoding is generally a bad choice,
since it harms performance in the high throughput regime.

Relatedly, we don't have a particular recommendation between vLLM and SGLang here.
Besides the points made above about host overhead latency vs bulk throughput,
the primary difference we have seen is that vLLM is a bit faster to market with new models
and new features, but SGLang is a bit easier to hack on and extend.

### Serving bursty LLM inference workloads on Modal

Modal's rapid autoscaling infrastructure,
from [the custom container runtime and filesystem](/blog/jono-containers-talk),
to [memory snapshot support](/blog/gpu-mem-snapshots),
is particularly well-suited
to bursty LLM inference workloads.

These workloads can either be served by vanilla
[Modal Functions](/docs/guide/apps)
invoked via remote Python procedure calling or as
[web endpoints](/docs/guide/webhooks)
invoked via HTTP.
Web endpoints are better for integrating with a variety
of producers and consumers.
The tradeoff of lower overhead for increased complexity
with `modal.experimental.http_server` is generally not worth it.

The [`@modal.concurrent` decorator](/docs/guide/concurrent-inputs)
supports setting both a limit (`max_inputs`)
and a target (`target_inputs`).
Set the limit higher than the target to absorb load increases into
existing capacity (typically at the expense of longer latency).
Make sure that the inference server is configured to handle batches as large as `max_inputs`
without internal queueing!

Almost all GPU programs can be snapshot, but most GPU programs
require some code changes to be snapshot.
For instance, both the vLLM and SGLang inference servers require
manual offloading of weights/KV cache to CPU memory before snapshotting.

For details, see our full sample code for running bursty workloads on Modal
with vLLM [here](https://modal.com/docs/examples/vllm_snapshot)
and with SGLang [here](https://modal.com/docs/examples/sglang_snapshot).
# Geographic Latency

Modal's worker cluster is multi-cloud and multi-region. The vast majority of workers are located
in the continental USA, but we do run workers in Europe and Asia.

Modal's control plane is hosted in Virginia, USA (`us-east-1`).

Any time data needs to travel between the Modal client, our control plane servers, and our workers
latency will be incurred. [Cloudping.co](https://www.cloudping.co) provides good estimates on the
significance of the latency between regions. For example, the roundtrip latency between AWS `us-east-1` (Virginia, USA) and
`us-west-1` (California, USA) is around 60ms.

You can observe the location identifier of a container [via an environment variable](/docs/guide/environment_variables).
Logging this environment variable alongside latency information can reveal when geography is impacting your application
performance.

## Region selection

In cases where low-latency communication is required between your container and a network dependency (e.g a database),
it is useful to ensure that Modal schedules your container in only regions geographically proximate to that dependency.
For example, if you have an AWS RDS database in Virginia, USA (`us-east-1`), ensuring your Modal containers are also scheduled in Virginia
means that network latency between the container and the database will be less than 5 milliseconds.

For more information, please see [Region selection](/docs/guide/region-selection).
# Apps, Functions, and entrypoints

An [`App`](/docs/reference/modal.App) represents an application running on Modal. It groups one or more Functions for atomic deployment and acts as a shared namespace. All Functions and Clses are associated with an
App.

A [`Function`](/docs/reference/modal.Function) acts as an independent unit once it is deployed, and [scales up and down](/docs/guide/scale) independently from other Functions. If there are no live inputs to the Function then by default, no containers will run and your account will not be charged for compute resources, even if the App it belongs to is deployed.

An App can be ephemeral or deployed. You can view a list of all currently running Apps on the [`apps`](/apps) page.

The code for a Modal App defining two separate Functions might look something like this:

```python

import modal

app = modal.App(name="my-modal-app")


@app.function()
def f():
    print("Hello world!")


@app.function()
def g():
    print("Goodbye world!")

```

## Ephemeral Apps

An ephemeral App is created when you use the
[`modal run`](/docs/reference/cli/run) CLI command, or the
[`app.run`](/docs/reference/modal.App#run) method. This creates a temporary
App that only exists for the duration of your script.

Ephemeral Apps are stopped automatically when the calling program exits, or when
the server detects that the client is no longer connected.
You can use
[`--detach`](/docs/reference/cli/run) in order to keep an ephemeral App running even
after the client exits.

By using `app.run` you can run your Modal apps from within your Python scripts:

```python
def main():
    ...
    with app.run():
        some_modal_function.remote()
```

By default, running your app in this way won't propagate Modal logs and progress bar messages. To enable output, use the [`modal.enable_output`](/docs/reference/modal.enable_output) context manager:

```python
def main():
    ...
    with modal.enable_output():
        with app.run():
            some_modal_function.remote()
```

## Deployed Apps

A deployed App is created using the [`modal deploy`](/docs/reference/cli/deploy)
CLI command. The App is persisted indefinitely until you stop it via the
[web UI](/apps) or the [`modal app stop`](/docs/reference/cli/app#modal-app-stop) command. Functions in a deployed App that have an attached
[schedule](/docs/guide/cron) will be run on a schedule. Otherwise, you can
invoke them manually using
[web endpoints or Python](/docs/guide/trigger-deployed-functions).

Deployed Apps are named via the [`App`](/docs/reference/modal.App#modalapp)
constructor. Re-deploying an existing `App` (based on the name) will update it
in place.

## Entrypoints for ephemeral Apps

The code that runs first when you `modal run` an App is called the "entrypoint".

You can register a local entrypoint using the
[`@app.local_entrypoint()`](/docs/reference/modal.App#local_entrypoint)
decorator. You can also use a regular Modal function as an entrypoint, in which
case only the code in global scope is executed locally.

### Argument parsing

If your entrypoint function takes arguments with primitive types, `modal run`
automatically parses them as CLI options. For example, the following function
can be called with `modal run script.py --foo 1 --bar "hello"`:

```python
# script.py

@app.local_entrypoint()
def main(foo: int, bar: str):
    some_modal_function.remote(foo, bar)
```

If you wish to use your own argument parsing library, such as `argparse`, you can instead accept a variable-length argument list for your entrypoint or your function. In this case, Modal skips CLI parsing and forwards CLI arguments as a tuple of strings. For example, the following function can be invoked with `modal run my_file.py --foo=42 --bar="baz"`:

```python
import argparse

@app.function()
def train(*arglist):
    parser = argparse.ArgumentParser()
    parser.add_argument("--foo", type=int)
    parser.add_argument("--bar", type=str)
    args = parser.parse_args(args = arglist)
```

### Manually specifying an entrypoint

If there is only one `local_entrypoint` registered,
[`modal run script.py`](/docs/reference/cli/run) will automatically use it. If
you have no entrypoint specified, and just one decorated Modal function, that
will be used as a remote entrypoint instead. Otherwise, you can direct
`modal run` to use a specific entrypoint.

For example, if you have a function decorated with
[`@app.function()`](/docs/reference/modal.App#function) in your file:

```python
# script.py

@app.function()
def f():
    print("Hello world!")


@app.function()
def g():
    print("Goodbye world!")


@app.local_entrypoint()
def main():
    f.remote()
```

Running [`modal run script.py`](/docs/reference/cli/run) will execute the `main`
function locally, which would call the `f` function remotely. However you can
instead run `modal run script.py::app.f` or `modal run script.py::app.g` to
execute `f` or `g` directly.

## Apps were once Stubs

The `modal.App` class in the client was previously called `modal.Stub`. The
old name was kept as an alias for some time, but from Modal 1.0.0 onwards,
using `modal.Stub` will result in an error.
# Managing deployments

Once you've finished using `modal run` or `modal serve` to iterate on your Modal
code, it's time to deploy. A Modal deployment creates and then persists an
application and its objects, providing the following benefits:

- Repeated application function executions will be grouped under the deployment,
  aiding observability and usage tracking. Programmatically triggering lots of
  ephemeral App runs can clutter your web and CLI interfaces.
- Function calls are much faster because deployed functions are persistent and
  reused, not created on-demand by calls. Learn how to trigger deployed
  functions in
  [Invoking deployed functions](/docs/guide/trigger-deployed-functions).
- [Scheduled functions](/docs/guide/cron) will continue scheduling separate from
  any local iteration you do, and will notify you on failure.
- [Web endpoints](/docs/guide/webhooks) keep running when you close your laptop,
  and their URL address matches the deployment name.

## Creating deployments

Deployments are created using the
[`modal deploy` command](/docs/reference/cli/app#modal-app-list).

```
 % modal deploy -m whisper_pod_transcriber.main
✓ Initialized. View app page at https://modal.com/apps/ap-PYc2Tb7JrkskFUI8U5w0KG.
✓ Created objects.
├── 🔨 Created populate_podcast_metadata.
├── 🔨 Mounted /home/ubuntu/whisper_pod_transcriber at /root/whisper_pod_transcriber
├── 🔨 Created fastapi_app => https://modal-labs-whisper-pod-transcriber-fastapi-app.modal.run
├── 🔨 Mounted /home/ubuntu/whisper_pod_transcriber/whisper_frontend/dist at /assets
├── 🔨 Created search_podcast.
├── 🔨 Created refresh_index.
├── 🔨 Created transcribe_segment.
├── 🔨 Created transcribe_episode..
└── 🔨 Created fetch_episodes.
✓ App deployed! 🎉

View Deployment: https://modal.com/apps/modal-labs/whisper-pod-transcriber
```

Running this command on an existing deployment will redeploy the App,
incrementing its version. For detail on how live deployed apps transition
between versions, see the [Updating deployments](#updating-deployments) section.

Deployments can also be created programmatically using Modal's
[Python API](/docs/reference/modal.App#deploy).

## Viewing deployments

Deployments can be viewed either on the [apps](/apps) web page or by using the
[`modal app list` command](/docs/reference/cli/app#modal-app-list).

## Updating deployments

A deployment can deploy a new App or redeploy a new version of an existing
deployed App. It's useful to understand how Modal handles the transition between
versions when an App is redeployed. In general, Modal aims to support
zero-downtime deployments by gradually transitioning traffic to the new version.

If the deployment involves building new versions of the Images used by the App,
the build process will need to complete successfully. The existing version of
the App will continue to handle requests during this time. Errors during the
build will abort the deployment with no change to the status of the App.

After the build completes, Modal will start to bring up new containers running
the latest version of the App. The existing containers will continue handling
requests (using the previous version of the App) until the new containers have
completed their cold start.

Once the new containers are ready, old containers will stop accepting new
requests. However, the old containers will continue running any requests they
had previously accepted. The old containers will not terminate until they have
finished processing all ongoing requests.

Any warm pool containers will also be cycled during a deployment, as the
previous version's warm pool are now outdated.

## Deployment rollbacks

To quickly reset an App back to a previous version, you can perform a deployment
_rollback_. Rollbacks can be triggered from either the App dashboard or the CLI.
Rollback deployments look like new deployments: they increment the version number
and are attributed to the user who triggered the rollback. But the App's functions
and metadata will be reset to their previous state independently of your current
App codebase.

Note that deployment rollbacks are supported only on the Team and Enterprise plans.

## Stopping deployments

Deployed apps can be stopped in the web UI by clicking the red "Stop app" button on
the App's "Overview" page, or alternatively from the command line using the
[`modal app stop` command](/docs/reference/cli/app#modal-app-stop).

Stopping an App is a destructive action. Apps cannot be restarted from this state;
a new App will need to be deployed from the same source files. Objects associated
with stopped deployments will eventually be garbage collected.
# Invoking deployed functions

Modal lets you take a function created by a
[deployment](/docs/guide/managing-deployments) and call it from other contexts.

There are two ways of invoking deployed functions. If the invoking client is
running Python, then the same
[Modal client library](https://pypi.org/project/modal/) used to write Modal code
can be used. HTTPS is used if the invoking client is not running Python and
therefore cannot import the Modal client library.

## Invoking with Python

Some use cases for Python invocation include:

- An existing Python web server (eg. Django, Flask) wants to invoke Modal
  functions.
- You have split your product or system into multiple Modal applications that
  deploy independently and call each other.

### Function lookup and invocation basics

Let's say you have a script `my_shared_app.py` and this script defines a Modal
app with a function that computes the square of a number:

```python
import modal

app = modal.App("my-shared-app")


@app.function()
def square(x: int):
    return x ** 2
```

You can deploy this app to create a persistent deployment:

```
% modal deploy shared_app.py
✓ Initialized.
✓ Created objects.
├── 🔨 Created square.
├── 🔨 Mounted /Users/erikbern/modal/shared_app.py.
✓ App deployed! 🎉

View Deployment: https://modal.com/apps/erikbern/my-shared-app
```

Let's try to run this function from a different context. For instance, let's
fire up the Python interactive interpreter:

```bash
% python
Python 3.9.5 (default, May  4 2021, 03:29:30)
[Clang 12.0.0 (clang-1200.0.32.27)] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> import modal
>>> f = modal.Function.from_name("my-shared-app", "square")
>>> f.remote(42)
1764
>>>
```

This works exactly the same as a regular modal `Function` object. For example,
you can `.map()` over functions invoked this way too:

```bash
>>> f = modal.Function.from_name("my-shared-app", "square")
>>> f.map([1, 2, 3, 4, 5])
[1, 4, 9, 16, 25]
```

#### Authentication

The Modal Python SDK will read the token from `~/.modal.toml` which typically is
created using `modal token new`.

Another method of providing the credentials is to set the environment variables
`MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`. If you want to call a Modal function
from a context such as a web server, you can expose these environment variables
to the process.

#### Lookup of lifecycle functions

[Lifecycle functions](/docs/guide/lifecycle-functions) are defined on classes,
which you can look up in a different way. Consider this code:

```python
import modal

app = modal.App("my-shared-app")


@app.cls()
class MyLifecycleClass:
    @modal.enter()
    def enter(self):
        self.var = "hello world"

    @modal.method()
    def foo(self):
        return self.var
```

Let's say you deploy this app. You can then call the function by doing this:

```bash
>>> cls = modal.Cls.from_name("my-shared-app", "MyLifecycleClass")
>>> obj = cls()  # You can pass any constructor arguments here
>>> obj.foo.remote()
'hello world'
```

### Asynchronous invocation

In certain contexts, a Modal client will need to trigger Modal functions without
waiting on the result. This is done by spawning functions and receiving a
[`FunctionCall`](/docs/reference/modal.FunctionCall) as a
handle to the triggered execution.

The following is an example of a Flask web server (running outside Modal) which
accepts model training jobs to be executed within Modal. Instead of the HTTP
POST request waiting on a training job to complete, which would be infeasible,
the relevant Modal function is spawned and the
[`FunctionCall`](/docs/reference/modal.FunctionCall)
object is stored for later polling of execution status.

```python
from uuid import uuid4
from flask import Flask, jsonify, request

app = Flask(__name__)
pending_jobs = {}

...

@app.route("/jobs", methods = ["POST"])
def create_job():
    predict_fn = modal.Function.from_name("example", "train_model")
    job_id = str(uuid4())
    function_call = predict_fn.spawn(
        job_id=job_id,
        params=request.json,
    )
    pending_jobs[job_id] = function_call
    return {
        "job_id": job_id,
        "status": "pending",
    }
```

### Importing a Modal function between Modal apps

You can also import one function defined in an app from another app:

```python
import modal

app = modal.App("another-app")

square = modal.Function.from_name("my-shared-app", "square")


@app.function()
def cube(x):
    return x * square.remote(x)


@app.local_entrypoint()
def main():
    assert cube.remote(42) == 74088
```

### Comparison with HTTPS

Compared with HTTPS invocation, Python invocation has the following benefits:

- Avoids the need to create web endpoint functions.
- Avoids handling serialization of request and response data between Modal and
  your client.
- Uses the Modal client library's built-in authentication.
  - Web endpoints are public to the entire internet, whereas function `lookup`
    only exposes your code to you (and your org).
- You can work with shared Modal functions as if they are normal Python
  functions, which might be more convenient.

## Invoking with HTTPS

Any application that can make HTTPS requests can interact with deployed Modal
applications via [web endpoint functions](/docs/guide/webhooks). Note that
all deployed web endpoint functions have [a stable HTTPS
URL](/docs/guide/webhook-urls).

Some use cases for HTTPS invocation include:

- Calling Modal functions from a web browser client running JavaScript
- Calling Modal functions from backend services in languages we don't yet have
  official SDKs for (Java, Ruby, etc.)
- Calling Modal functions using UNIX tools (`curl`, `wget`)

However, if the client of your Modal deployment is running Python, JavaScript,
or Go, it's better to use the [Modal Python
SDK](https://pypi.org/project/modal/) or [libmodal SDKs for JavaScript and
Go](/docs/guide/sdk-javascript-go) to invoke your Modal code.

For more detail on setting up functions for invocation over HTTP see the
[web endpoints guide](/docs/guide/webhooks).


# Filesystem Access

There are multiple options for uploading files to a Sandbox and accessing them
from outside the Sandbox.

## Efficient file syncing

To efficiently upload local files to a Sandbox, you can use the
[`add_local_file`](/docs/reference/modal.Image#add_local_file) and
[`add_local_dir`](/docs/reference/modal.Image#add_local_dir) methods on the
[`Image`](/docs/reference/modal.Image) class:

```python notest
sb = modal.Sandbox.create(
    app=my_app,
    image=modal.Image.debian_slim().add_local_dir(
        local_path="/home/user/my_dir",
        remote_path="/app"
    )
)
p = sb.exec("ls", "/app")
print(p.stdout.read())
p.wait()
```

Alternatively, it's possible to use Modal [Volume](/docs/reference/modal.Volume)s or
[CloudBucketMount](/docs/guide/cloud-bucket-mounts)s. These have the benefit that
files created from inside the Sandbox can easily be accessed outside the
Sandbox.

To efficiently upload files to a Sandbox using a Volume, you can use the
[`batch_upload`](/docs/reference/modal.Volume#batch_upload) method on the
`Volume` class - for instance, using an ephemeral Volume that
will be garbage collected when the App finishes:

```python notest
with modal.Volume.ephemeral() as vol:
    import io
    with vol.batch_upload() as batch:
        batch.put_file("local-path.txt", "/remote-path.txt")
        batch.put_directory("/local/directory/", "/remote/directory")
        batch.put_file(io.BytesIO(b"some data"), "/foobar")

    sb = modal.Sandbox.create(
        volumes={"/cache": vol},
        app=my_app,
    )
    p = sb.exec("cat", "/cache/remote-path.txt")
    print(p.stdout.read())
    p.wait()
    sb.terminate()
```

The caller also can access files created in the Volume from the Sandbox, even after the Sandbox is terminated:

```python notest
with modal.Volume.ephemeral() as vol:
    sb = modal.Sandbox.create(
        volumes={"/cache": vol},
        app=my_app,
    )
    p = sb.exec("bash", "-c", "echo foo > /cache/a.txt")
    p.wait()
    sb.terminate()
    sb.wait(raise_on_termination=False)
    for data in vol.read_file("a.txt"):
        print(data)
```

Alternatively, if you want to persist files between Sandbox invocations (useful
if you're building a stateful code interpreter, for example), you can use create
a persisted `Volume` with a dynamically assigned label:

```python notest
session_id = "example-session-id-123abc"
vol = modal.Volume.from_name(f"vol-{session_id}", create_if_missing=True)
sb = modal.Sandbox.create(
    volumes={"/cache": vol},
    app=my_app,
)
p = sb.exec("bash", "-c", "echo foo > /cache/a.txt")
p.wait()
sb.terminate()
sb.wait(raise_on_termination=False)
for data in vol.read_file("a.txt"):
    print(data)
```

File syncing behavior differs between Volumes and CloudBucketMounts. For
Volumes, files are only synced back to the Volume when the Sandbox terminates.
For CloudBucketMounts, files are synced automatically.

### Committing Volume changes with `sync` (v2 only)

For [Volumes v2](/docs/guide/volumes#volumes-v2-overview), you can explicitly
commit changes at any point during Sandbox execution by running the `sync`
command on the mountpoint. This persists all data and metadata changes to the
Volume's storage without waiting for the Sandbox to terminate:

```python notest
sb = modal.Sandbox.create(
    volumes={"/data": modal.Volume.from_name("my-v2-volume")},
    app=my_app,
)

# Write files to the volume
sb.exec("bash", "-c", "echo 'hello' > /data/output.txt").wait()

# Commit changes immediately
p = sb.exec("sync", "/data")
p.wait()
if p.returncode != 0:
    raise Exception(f"sync failed with exit code {p.returncode}")

# Changes are now persisted and visible to other containers
```

This is particularly useful for long-running Sandboxes where you want to
persist intermediate results, or when you need changes to be visible to other
containers before the Sandbox terminates.

## Filesystem API (Alpha)

If you're less concerned with efficiency of uploads and want a convenient way
to pass data in and out of the Sandbox during execution, you can use our
filesystem API to easily read and write files. The API supports reading
files up to 100 MiB and writes up to 1 GiB in size.

This API is currently in Alpha, and we don't recommend using it for production
workloads.

```python
import modal

app = modal.App.lookup("sandbox-fs-demo", create_if_missing=True)

sb = modal.Sandbox.create(app=app)

with sb.open("test.txt", "w") as f:
    f.write("Hello World\n")

f = sb.open("test.txt", "rb")
print(f.read())
f.close()
```

The filesystem API is similar to Python's built-in [io.FileIO](https://docs.python.org/3/library/io.html#io.FileIO) and supports many of the same methods, including `read`, `readline`, `readlines`, `write`, `flush`, `seek`, and `close`.

We additionally provide commands [`mkdir`](/docs/reference/modal.Sandbox#mkdir), [`rm`](/docs/reference/modal.Sandbox#rm), and [`ls`](/docs/reference/modal.Sandbox#ls) to make interacting with the filesystem more ergonomic.

<!-- TODO(WRK-956) -->
<!-- ## File Watching

You can watch files or directories for changes using [`watch`](/docs/reference/modal.Sandbox#watch), which is conceptually similar to [`fsnotify`](https://pkg.go.dev/github.com/fsnotify/fsnotify).

```python notest
from modal.file_io import FileWatchEventType

async def watch(sb: modal.Sandbox):
    event_stream = sb.watch.aio(
        "/watch",
        recursive=True,
        filter=[FileWatchEventType.Create, FileWatchEventType.Modify],
    )
    async for event in event_stream:
        print(event)

async def main():
    app = modal.App.lookup("sandbox-file-watch", create_if_missing=True)
    sb = await modal.Sandbox.create.aio(app=app)
    asyncio.create_task(watch(sb))

    await sb.mkdir.aio("/watch")
    for i in range(10):
        async with await sb.open.aio(f"/watch/bar-{i}.txt", "w") as f:
            await f.write.aio(f"hello-{i}")
``` -->


# Snapshots

Sandboxes support snapshotting, allowing you to save your Sandbox's state
and restore it later. This is useful for:

- Creating custom environments for your Sandboxes to run in
- Backing up your Sandbox's state for debugging
- Running large-scale experiments with the same initial state
- Branching your Sandbox's state to test different code changes independently

## Filesystem Snapshots

Filesystem Snapshots are copies of the Sandbox's filesystem at a given point in time.
These Snapshots are [Images](/docs/reference/modal.Image) and can be used to create
new Sandboxes.

To create a Filesystem Snapshot, you can use the
[`Sandbox.snapshot_filesystem()`](/docs/reference/modal.Sandbox#snapshot_filesystem) method:

```python notest
import modal

app = modal.App.lookup("sandbox-fs-snapshot-test", create_if_missing=True)

sb = modal.Sandbox.create(app=app)
p = sb.exec("bash", "-c", "echo 'test' > /test")
p.wait()
assert p.returncode == 0, "failed to write to file"
image = sb.snapshot_filesystem()
sb.terminate()

sb2 = modal.Sandbox.create(image=image, app=app)
p2 = sb2.exec("bash", "-c", "cat /test")
assert p2.stdout.read().strip() == "test"
sb2.terminate()
```

Filesystem Snapshots are optimized for performance: they are calculated as the difference
from your base image, so only modified files are stored. Restoring a Filesystem Snapshot
utilizes the same infrastructure we use to get fast cold starts for your Sandboxes.

Filesystem Snapshots will generally persist indefinitely.

## Memory Snapshots

[Sandboxes memory snapshots](/docs/guide/sandbox-memory-snapshots) are in early preview.
Contact us if this is something you're interested in!
