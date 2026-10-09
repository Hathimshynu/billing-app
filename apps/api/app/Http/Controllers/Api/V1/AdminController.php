<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Attachment;
use App\Models\AuditLog;
use App\Models\BusinessUser;
use App\Models\Expense;
use App\Services\Sync\SyncEntityMap;
use App\Support\ApiResponse;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Audit log, online backup export and file attachments.
 */
class AdminController extends Controller
{
    public function __construct(private readonly TenantContext $tenant, private readonly BusinessLock $lock) {}

    public function auditLogs(Request $request): JsonResponse
    {
        $query = AuditLog::query()->with('user:id,name,email')->where('business_id', $this->tenant->businessId())->orderByDesc('id');
        foreach (['action', 'entity_type', 'entity_id', 'user_id', 'device_id'] as $filter) {
            if ($value = $request->query($filter)) {
                $query->where($filter, $value);
            }
        }
        if ($from = $request->query('from')) {
            $query->where('created_at', '>=', $from);
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 50), 200)), fn (AuditLog $log) => [
            'id' => $log->id,
            'user' => $log->user ? ['id' => $log->user->id, 'name' => $log->user->name] : null,
            'action' => $log->action,
            'entity_type' => $log->entity_type,
            'entity_id' => $log->entity_id,
            'old_values' => $log->old_values,
            'new_values' => $log->new_values,
            'device_id' => $log->device_id,
            'ip_address' => $log->ip_address,
            'created_at' => $log->created_at?->toIso8601ZuluString(),
        ]);
    }

    /**
     * Streams a JSON export of every entity of the business (online backup / data portability).
     */
    public function export(): StreamedResponse
    {
        $business = $this->tenant->business();
        $filename = 'shopdesk-backup-'.str($business->name)->slug().'-'.now()->format('Ymd-His').'.json';

        return response()->streamDownload(function () use ($business) {
            echo '{"format":"shopdesk-backup","version":1,"exported_at":'.json_encode(now()->toIso8601ZuluString()).',"business_id":'.json_encode($business->id).',"entities":{';
            $firstType = true;
            foreach (array_keys(SyncEntityMap::MAP) as $type) {
                [$class, $with] = SyncEntityMap::MAP[$type];
                echo ($firstType ? '' : ',').json_encode($type).':[';
                $firstType = false;
                $first = true;
                $query = $class::query()->with($with);
                if ($type === 'business') {
                    $query->whereKey($business->id);
                }
                $query->orderBy($class === BusinessUser::class ? 'id' : (new $class)->getKeyName())->chunk(500, function ($models) use (&$first) {
                    foreach ($models as $model) {
                        echo ($first ? '' : ',').json_encode($model->toSyncArray());
                        $first = false;
                    }
                });
                echo ']';
            }
            echo '}}';
        }, $filename, ['Content-Type' => 'application/json']);
    }

    public function uploadAttachment(Request $request): JsonResponse
    {
        $data = $request->validate([
            'entity_type' => ['required', Rule::in(['expense'])],
            'entity_id' => ['required', 'uuid'],
            'file' => ['required', 'file', 'max:5120', 'mimes:jpg,jpeg,png,webp,pdf'],
        ]);
        $expense = Expense::query()->findOrFail($data['entity_id']);
        $file = $request->file('file');
        $path = $file->store('attachments/'.$this->tenant->businessId(), 'public');

        $this->lock->transaction((string) $this->tenant->businessId(), function () use ($expense, $path, $file, $data) {
            Attachment::query()->create([
                'entity_type' => $data['entity_type'],
                'entity_id' => $expense->id,
                'path' => $path,
                'filename' => mb_substr($file->getClientOriginalName(), 0, 200),
                'mime' => (string) $file->getMimeType(),
                'size' => (int) $file->getSize(),
                'created_by' => $this->tenant->userId(),
            ]);
            $expense->attachment_path = $path;
            $expense->save();
        });

        return ApiResponse::created(['attachment_url' => Storage::disk('public')->url($path), 'expense' => $expense->refresh()->toSyncArray()]);
    }
}
